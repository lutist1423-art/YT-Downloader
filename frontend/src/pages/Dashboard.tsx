import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import UserHeader from "../components/UserHeader";
import CopyrightNotice from "../components/CopyrightNotice";
import { ApiError, createDownload, getDownload, getMe, listDownloads } from "../lib/api";
import type { DownloadDetail, DownloadStatus, Me } from "../lib/types";

const POLL_INTERVAL_MS = 4500;
const IN_FLIGHT_STATUSES: DownloadStatus[] = ["QUEUED", "PROCESSING"];

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

export default function Dashboard(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [downloads, setDownloads] = useState<DownloadDetail[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
      const created = await createDownload(trimmed);
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
          <h2>Download history</h2>
          {downloads.length === 0 ? (
            <p className="hint">No downloads yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Video URL</th>
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
