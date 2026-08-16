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

DOWNLOADS_TABLE = os.environ["DOWNLOADS_TABLE_NAME"]
USERS_TABLE = os.environ["USERS_TABLE_NAME"]
PROCESSED_VIDEOS_BUCKET = os.environ["PROCESSED_VIDEOS_BUCKET_NAME"]

downloads_table = dynamodb.Table(DOWNLOADS_TABLE)
users_table = dynamodb.Table(USERS_TABLE)

MAX_FILESIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2GB safety cap


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


def _download_video(video_url: str, work_dir: str) -> tuple[str, str]:
    output_template = os.path.join(work_dir, "%(id)s.%(ext)s")

    ydl_opts = {
        "format": "bestvideo[ext=mp4][filesize<?2G]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "merge_output_format": "mp4",
        "outtmpl": output_template,
        "max_filesize": MAX_FILESIZE_BYTES,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "ffmpeg_location": "/usr/local/bin",
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        final_path = ydl.prepare_filename(info)
        title = info.get("title", "video")
        return final_path, title


def _process_record(body: dict) -> None:
    download_id = body["downloadId"]
    user_id = body["userId"]
    video_url = body["videoUrl"]

    _mark_processing(download_id)

    work_dir = f"/tmp/{uuid.uuid4()}"
    os.makedirs(work_dir, exist_ok=True)

    try:
        try:
            local_path, title = _download_video(video_url, work_dir)
        except yt_dlp.utils.DownloadError as exc:
            raise TerminalDownloadError(str(exc)) from exc

        if not os.path.exists(local_path):
            raise TerminalDownloadError("yt-dlp reported success but output file is missing.")

        s3_key = f"{user_id}/{download_id}.mp4"
        s3.upload_file(local_path, PROCESSED_VIDEOS_BUCKET, s3_key)

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
