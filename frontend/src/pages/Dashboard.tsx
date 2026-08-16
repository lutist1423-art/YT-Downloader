import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import UserHeader from "../components/UserHeader";
import CopyrightNotice from "../components/CopyrightNotice";
import {
  ApiError,
  createDownload,
  deleteCookies,
  getDownload,
  getMe,
  listDownloads,
  uploadCookies,
} from "../lib/api";
import type { DownloadDetail, DownloadFormat, DownloadQuality, DownloadStatus, Me } from "../lib/types";

const POLL_INTERVAL_MS = 4500;
const IN_FLIGHT_STATUSES: DownloadStatus[] = ["QUEUED", "PROCESSING"];
const MAX_COOKIES_BYTES = 100 * 1024;

function mergeDownload(list: DownloadDetail[], updated: DownloadDetail): DownloadDetail[] {
  const idx = list.findIndex((d) => d.downloadId === updated.downloadId);
  if (idx === -1) return [updated, ...list];
  const next = list.slice();
  next[idx] = { ...next[idx], ...updated };
  return next;
}

function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function formatQualityLabel(d: DownloadDetail): string {
  if (d.format === "mp3") return "MP3 audio";
  return d.quality === "best" ? "MP4 (best)" : `MP4 ${d.quality}`;
}

export default function Dashboard(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [downloads, setDownloads] = useState<DownloadDetail[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [quality, setQuality] = useState<DownloadQuality>("best");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cookiesText, setCookiesText] = useState("");
  const [cookiesBusy, setCookiesBusy] = useState(false);
  const [cookiesMessage, setCookiesMessage] = useState<string | null>(null);
  const [cookiesFileName, setCookiesFileName] = useState<string | null>(null);

  const downloadsRef = useRef<DownloadDetail[]>([]);
  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  const refreshMe = useCallback(async () => {
    const meData = await getMe();
    setMe(meData);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meData, downloadsData] = await Promise.all([getMe(), listDownloads()]);
        if (cancelled) return;
        setMe(meData);
        setDownloads(downloadsData.items);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load your account.");
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll any in-flight downloads for live status updates.
  useEffect(() => {
    const interval = window.setInterval(async () => {
      const pending = downloadsRef.current.filter((d) => IN_FLIGHT_STATUSES.includes(d.status));
      if (pending.length === 0) return;
      try {
        const results = await Promise.all(pending.map((d) => getDownload(d.downloadId)));
        setDownloads((prev) => results.reduce((acc, r) => mergeDownload(acc, r), prev));
        if (results.some((r) => r.status === "COMPLETED" || r.status === "FAILED")) {
          // A credit may have just been consumed/confirmed server-side already at
          // creation time, but refresh anyway to stay in sync in case of retries.
          refreshMe().catch(() => undefined);
        }
      } catch {
        // Transient polling errors are not shown to the user; next tick retries.
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshMe]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmed = videoUrl.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      const created = await createDownload(trimmed, format, quality);
      setDownloads((prev) => mergeDownload(prev, created));
      setVideoUrl("");
      refreshMe().catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errorCode === "NO_CREDITS") {
          setFormError("You're out of credits. Please contact an admin to get more.");
        } else if (err.errorCode === "RATE_LIMITED") {
          setFormError("You're sending requests too fast. Please slow down and try again.");
        } else if (err.errorCode === "INVALID_URL") {
          setFormError("That doesn't look like a valid YouTube URL.");
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(err instanceof Error ? err.message : "Could not start download.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleCookiesFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCookiesMessage(null);
    if (file.size > MAX_COOKIES_BYTES) {
      setCookiesMessage("That file is too large (max 100KB) - a cookies.txt export is normally just a few KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCookiesText(String(reader.result ?? ""));
      setCookiesFileName(file.name);
    };
    reader.onerror = () => setCookiesMessage("Could not read that file.");
    reader.readAsText(file);
  }

  async function handleCookiesSave() {
    if (!cookiesText.trim()) return;
    setCookiesBusy(true);
    setCookiesMessage(null);
    try {
      await uploadCookies(cookiesText);
      setCookiesMessage("Cookies saved. New downloads will use them.");
      setCookiesText("");
      setCookiesFileName(null);
      refreshMe().catch(() => undefined);
    } catch (err) {
      setCookiesMessage(err instanceof Error ? err.message : "Could not save cookies.");
    } finally {
      setCookiesBusy(false);
    }
  }

  async function handleCookiesRemove() {
    setCookiesBusy(true);
    setCookiesMessage(null);
    try {
      await deleteCookies();
      setCookiesMessage("Cookies removed.");
      refreshMe().catch(() => undefined);
    } catch (err) {
      setCookiesMessage(err instanceof Error ? err.message : "Could not remove cookies.");
    } finally {
      setCookiesBusy(false);
    }
  }

  const outOfCredits = (me?.credits ?? 0) <= 0;

  return (
    <div className="page page--user">
      <UserHeader />
      <main className="container">
        {loadError && <div className="alert alert--error">{loadError}</div>}

        <section className="card credits-card">
          <h2>Your credits</h2>
          {loadingInitial || !me ? (
            <p>Loading...</p>
          ) : (
            <div className="credits-summary">
              <div className="credits-summary__stat">
                <span className="credits-summary__value">{me.credits}</span>
                <span className="credits-summary__label">remaining</span>
              </div>
              <div className="credits-summary__stat">
                <span className="credits-summary__value">{me.creditsUsed}</span>
                <span className="credits-summary__label">used</span>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Download a video</h2>
          <form className="download-form" onSubmit={handleSubmit}>
            <input
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              disabled={outOfCredits || submitting}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
            <div className="download-form__options">
              <label>
                Format
                <select
                  value={format}
                  disabled={outOfCredits || submitting}
                  onChange={(e) => setFormat(e.target.value as DownloadFormat)}
                >
                  <option value="mp4">MP4 (video)</option>
                  <option value="mp3">MP3 (audio only)</option>
                </select>
              </label>
              {format === "mp4" && (
                <label>
                  Quality
                  <select
                    value={quality}
                    disabled={outOfCredits || submitting}
                    onChange={(e) => setQuality(e.target.value as DownloadQuality)}
                  >
                    <option value="best">Best available</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                    <option value="360p">360p</option>
                  </select>
                </label>
              )}
            </div>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={outOfCredits || submitting}
            >
              {submitting ? "Submitting..." : "Download"}
            </button>
          </form>
          {outOfCredits && !loadingInitial && (
            <p className="hint hint--warning">
              You have no credits left. Please contact an admin to get more before you can
              download.
            </p>
          )}
          {formError && <div className="alert alert--error">{formError}</div>}
        </section>

        <section className="card">
          <h2>YouTube cookies</h2>
          <p className="hint">
            YouTube sometimes blocks downloads from cloud servers with a "confirm you're not a
            bot" check. Uploading cookies from a signed-in YouTube session (exported as{" "}
            <code>cookies.txt</code> via a browser extension) usually avoids this.{" "}
            <strong>
              Use a secondary/throwaway Google account, not your main one
            </strong>{" "}
            - anyone able to read our servers would be able to act as that session on YouTube for
            as long as the cookies remain valid. We store the file privately and it is never
            served back through the app; you can remove it at any time.
          </p>
          <details className="cookies-howto">
            <summary>How do I get a cookies.txt file?</summary>
            <ol>
              <li>
                Install a browser extension that exports cookies in <strong>Netscape format</strong>{" "}
                (a plain text, tab-separated file - not JSON): <strong>"Get cookies.txt LOCALLY"</strong>{" "}
                for Chrome/Edge/Brave, or <strong>"cookies.txt"</strong> for Firefox.
              </li>
              <li>
                In a private/incognito window (or a separate browser profile), sign in to a{" "}
                <strong>secondary/throwaway</strong> Google account - not your main one.
              </li>
              <li>
                Go to <code>youtube.com</code> and confirm you're signed in (avatar icon top-right).
              </li>
              <li>Click the extension icon, make sure it's exporting for the current site (youtube.com), and export/download the file.</li>
              <li>Come back here, pick that file below, and click "Save cookies".</li>
            </ol>
            <p>
              Cookies expire after a while (weeks to months). If downloads that used to work start
              failing with a "sign in" error again, just repeat these steps and re-upload.
            </p>
          </details>
          <p className="hint">
            Current status:{" "}
            {me?.hasCookies ? (
              <strong>cookies uploaded</strong>
            ) : (
              <span>none uploaded (downloads use the site-wide fallback, if configured)</span>
            )}
          </p>
          <div className="cookies-form">
            <input type="file" accept=".txt" onChange={handleCookiesFile} disabled={cookiesBusy} />
            {cookiesFileName && <span className="hint">Selected: {cookiesFileName}</span>}
            <div className="cookies-form__actions">
              <button
                className="btn btn--small"
                type="button"
                disabled={cookiesBusy || !cookiesText.trim()}
                onClick={handleCookiesSave}
              >
                {cookiesBusy ? "Saving..." : "Save cookies"}
              </button>
              {me?.hasCookies && (
                <button
                  className="btn btn--small btn--danger"
                  type="button"
                  disabled={cookiesBusy}
                  onClick={handleCookiesRemove}
                >
                  Remove my cookies
                </button>
              )}
            </div>
          </div>
          {cookiesMessage && <p className="hint">{cookiesMessage}</p>}
        </section>

        <section className="card">
          <h2>Download history</h2>
          {downloads.length === 0 ? (
            <p className="hint">No downloads yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Video URL</th>
                    <th>Format</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((d) => (
                    <tr key={d.downloadId}>
                      <td className="table__url" title={d.videoUrl}>
                        {d.title ?? d.videoUrl}
                      </td>
                      <td>{formatQualityLabel(d)}</td>
                      <td>
                        <span className={`status-badge status-badge--${d.status.toLowerCase()}`}>
                          {statusLabel(d.status)}
                        </span>
                        {d.status === "FAILED" && d.errorMessage && (
                          <div className="table__error">{d.errorMessage}</div>
                        )}
                      </td>
                      <td>{new Date(d.requestedAt).toLocaleString()}</td>
                      <td>
                        {d.status === "COMPLETED" && d.downloadUrl && (
                          <a
                            className="btn btn--small"
                            href={d.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download file
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <CopyrightNotice />
    </div>
  );
}
