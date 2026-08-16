"""
SQS-triggered Lambda worker that downloads a single YouTube video with
yt-dlp, uploads the result to S3, and updates the Downloads record.

Credit accounting: the API layer already decremented the user's credit
balance (and recorded the download as QUEUED) before this job was ever
enqueued, to avoid a check-then-act race between concurrent requests. If the
download fails for a reason that is not the user's fault to retry (invalid
video, private/removed, region-blocked, etc.), we refund the credit here.
"""

import json
import logging
import os
import shutil
import time
import uuid
from datetime import datetime, timezone

import boto3
import yt_dlp
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
secrets_client = boto3.client("secretsmanager")

DOWNLOADS_TABLE = os.environ["DOWNLOADS_TABLE_NAME"]
USERS_TABLE = os.environ["USERS_TABLE_NAME"]
PROCESSED_VIDEOS_BUCKET = os.environ["PROCESSED_VIDEOS_BUCKET_NAME"]
USER_COOKIES_BUCKET = os.environ.get("USER_COOKIES_BUCKET_NAME")
COOKIES_SECRET_ARN = os.environ.get("COOKIES_SECRET_ARN")

downloads_table = dynamodb.Table(DOWNLOADS_TABLE)
users_table = dynamodb.Table(USERS_TABLE)

MAX_FILESIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2GB safety cap
FALLBACK_COOKIES_FILE_PATH = "/tmp/fallback_cookies.txt"

QUALITY_HEIGHT_CAP = {"1080p": 1080, "720p": 720, "480p": 480, "360p": 360}
CONTENT_TYPES = {"mp3": "audio/mpeg", "mp4": "video/mp4"}


class TerminalDownloadError(Exception):
    """A failure that should NOT be retried by SQS (bad URL, private video, etc.)."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mark_processing(download_id: str) -> None:
    downloads_table.update_item(
        Key={"downloadId": download_id},
        UpdateExpression="SET #s = :processing",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":processing": "PROCESSING"},
    )


def _mark_completed(download_id: str, s3_key: str, title: str) -> None:
    downloads_table.update_item(
        Key={"downloadId": download_id},
        UpdateExpression="SET #s = :completed, s3Key = :key, title = :title, completedAt = :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":completed": "COMPLETED",
            ":key": s3_key,
            ":title": title,
            ":now": _now_iso(),
        },
    )


def _mark_failed_and_refund(download_id: str, user_id: str, error_message: str) -> None:
    downloads_table.update_item(
        Key={"downloadId": download_id},
        UpdateExpression="SET #s = :failed, errorMessage = :err, completedAt = :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":failed": "FAILED",
            ":err": error_message[:500],
            ":now": _now_iso(),
        },
    )
    try:
        users_table.update_item(
            Key={"userId": user_id},
            UpdateExpression="SET credits = credits + :one, creditsUsed = creditsUsed - :one",
            ExpressionAttributeValues={":one": 1},
        )
    except ClientError:
        logger.exception("Failed to refund credit for user %s / download %s", user_id, download_id)


def _fetch_user_cookies_file(user_id: str) -> str | None:
    """
    Each download is processed in its own /tmp/{uuid} work_dir, so unlike
    the operator-wide fallback (cached across warm invocations), the
    per-user cookie file is fetched fresh every time - it's small (capped
    at 100KB by the upload API) and different users hit this on different
    invocations anyway.
    """
    if not USER_COOKIES_BUCKET:
        return None
    dest_path = "/tmp/user_cookies.txt"
    try:
        s3.download_file(USER_COOKIES_BUCKET, f"{user_id}.txt", dest_path)
        return dest_path
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
            return None
        logger.exception("Failed to fetch user cookies for %s", user_id)
        return None


def _fetch_fallback_cookies_file() -> str | None:
    """
    Operator-wide fallback cookies (see README), used for users who haven't
    uploaded their own. Cached on disk for the lifetime of this execution
    environment. Returns None if unconfigured or still the unpopulated
    placeholder.
    """
    if not COOKIES_SECRET_ARN:
        return None
    if os.path.exists(FALLBACK_COOKIES_FILE_PATH):
        return FALLBACK_COOKIES_FILE_PATH

    try:
        response = secrets_client.get_secret_value(SecretId=COOKIES_SECRET_ARN)
        content = response.get("SecretString", "")
    except ClientError:
        logger.exception("Failed to fetch fallback YouTube cookies secret")
        return None

    if not content.strip() or content.lstrip().startswith("# PLACEHOLDER"):
        return None

    with open(FALLBACK_COOKIES_FILE_PATH, "w") as f:
        f.write(content)
    return FALLBACK_COOKIES_FILE_PATH


def _resolve_cookies_file(user_id: str) -> tuple[str | None, str]:
    """Returns (path, source) where source is "user", "fallback", or "none" - surfaced
    in error messages so failures are diagnosable from the app UI alone."""
    user_cookies = _fetch_user_cookies_file(user_id)
    if user_cookies:
        return user_cookies, "user"
    fallback_cookies = _fetch_fallback_cookies_file()
    if fallback_cookies:
        return fallback_cookies, "fallback"
    return None, "none"


def _build_ydl_opts(work_dir: str, fmt: str, quality: str, user_id: str) -> tuple[dict, str]:
    output_template = os.path.join(work_dir, "%(id)s.%(ext)s")

    opts = {
        "outtmpl": output_template,
        "max_filesize": MAX_FILESIZE_BYTES,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "ffmpeg_location": "/usr/local/bin",
    }

    cookies_file, cookies_source = _resolve_cookies_file(user_id)
    if cookies_file:
        opts["cookiefile"] = cookies_file
        # The android/ios embedded clients ignore browser cookies entirely
        # (they use a different, token-based auth model YouTube has locked
        # down separately) and increasingly return no formats at all without
        # one. With real cookies available, "web" is what actually uses
        # them and gives the full format list.
        opts["extractor_args"] = {"youtube": {"player_client": ["web"]}}
    else:
        # No cookies available for this user (or the fallback): the android
        # client used to dodge the bot-check without cookies, though it's
        # becoming less reliable too as YouTube extends token requirements.
        opts["extractor_args"] = {"youtube": {"player_client": ["android", "ios", "web"]}}

    if fmt == "mp3":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
    else:
        # Don't filter by container (ext=mp4/m4a): the android/ios player
        # clients we prioritize to dodge the bot-check often only expose
        # different containers (e.g. webm) for a given video, so a strict
        # mp4/m4a filter can match nothing. merge_output_format below
        # already guarantees the final file is remuxed/transcoded to mp4.
        height = QUALITY_HEIGHT_CAP.get(quality)
        if height:
            opts["format"] = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
        else:
            opts["format"] = "bestvideo+bestaudio/best"
        opts["merge_output_format"] = "mp4"

    return opts, cookies_source


def _find_output_file(work_dir: str, video_id: str) -> str:
    """
    Post-processing (e.g. mp3 audio extraction) changes the file extension
    from what prepare_filename() would report pre-processing, so locate the
    actual output file on disk instead of trusting the original template.
    """
    skip_suffixes = (".part", ".ytdl", ".json", ".description", ".ytdl.part")
    for name in sorted(os.listdir(work_dir)):
        if name.startswith(video_id) and not name.endswith(skip_suffixes):
            return os.path.join(work_dir, name)
    raise TerminalDownloadError("yt-dlp reported success but the output file could not be located.")


def _download_video(video_url: str, work_dir: str, fmt: str, quality: str, user_id: str) -> tuple[str, str]:
    ydl_opts, cookies_source = _build_ydl_opts(work_dir, fmt, quality, user_id)

    try:
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
        except yt_dlp.utils.DownloadError as exc:
            # The requested height/codec combination isn't always available
            # for every video (different YouTube player clients expose
            # different format lists). Retry once with the most permissive
            # selector possible - whatever single format yt-dlp considers
            # "best" - rather than failing outright and burning the credit.
            if fmt != "mp3" and "Requested format is not available" in str(exc):
                logger.warning("Primary format selector failed for %s, retrying with format=best", video_url)
                fallback_opts = dict(ydl_opts)
                fallback_opts["format"] = "best"
                fallback_opts["postprocessors"] = [
                    {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}
                ]
                with yt_dlp.YoutubeDL(fallback_opts) as ydl:
                    info = ydl.extract_info(video_url, download=True)
            else:
                raise
    except yt_dlp.utils.DownloadError as exc:
        # Tag the source of cookies (or lack thereof) actually used onto the
        # error, so failures are diagnosable straight from the app's
        # download-history UI without needing CloudWatch access.
        raise yt_dlp.utils.DownloadError(f"[cookies:{cookies_source}] {exc}") from exc

    title = info.get("title", "video")
    final_path = _find_output_file(work_dir, info["id"])
    return final_path, title


def _process_record(body: dict) -> None:
    download_id = body["downloadId"]
    user_id = body["userId"]
    video_url = body["videoUrl"]
    fmt = body.get("format", "mp4")
    quality = body.get("quality", "best")

    _mark_processing(download_id)

    work_dir = f"/tmp/{uuid.uuid4()}"
    os.makedirs(work_dir, exist_ok=True)

    try:
        try:
            local_path, title = _download_video(video_url, work_dir, fmt, quality, user_id)
        except yt_dlp.utils.DownloadError as exc:
            raise TerminalDownloadError(str(exc)) from exc

        if not os.path.exists(local_path):
            raise TerminalDownloadError("yt-dlp reported success but output file is missing.")

        s3_key = f"{user_id}/{download_id}.{fmt}"
        s3.upload_file(
            local_path,
            PROCESSED_VIDEOS_BUCKET,
            s3_key,
            ExtraArgs={"ContentType": CONTENT_TYPES.get(fmt, "application/octet-stream")},
        )

        _mark_completed(download_id, s3_key, title)
        logger.info("Download %s completed for user %s", download_id, user_id)

    except TerminalDownloadError as exc:
        logger.warning("Terminal failure for download %s: %s", download_id, exc)
        _mark_failed_and_refund(download_id, user_id, str(exc))
        # Do not re-raise: this message should not be retried/DLQ'd, the job
        # is done (failed) as far as SQS is concerned.

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def handler(event, context):
    for record in event.get("Records", []):
        body = json.loads(record["body"])
        start = time.time()
        try:
            _process_record(body)
        except Exception:
            # Unexpected/transient error (S3, DynamoDB, network) - let SQS
            # retry the message up to the queue's maxReceiveCount, then DLQ.
            logger.exception("Unexpected error processing download %s", body.get("downloadId"))
            raise
        finally:
            logger.info("Processed record in %.1fs", time.time() - start)

    return {"batchItemFailures": []}
