import { ChangeEvent, Fragment, useEffect, useState } from "react";
import AdminHeader from "../components/AdminHeader";
import {
  adminDeleteUserCookies,
  adminResetUserPassword,
  adminSetUserCookies,
  ApiError,
  getUserDownloads,
  listAdminUsers,
  updateUserCredits,
} from "../lib/api";
import type { AdminUser, Download } from "../lib/types";

const MAX_COOKIES_BYTES = 100 * 1024;

export default function AdminDashboard(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedDownloads, setExpandedDownloads] = useState<Download[] | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const [resetBusyUserId, setResetBusyUserId] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<{ userId: string; text: string } | null>(null);

  const [cookiesBusyUserId, setCookiesBusyUserId] = useState<string | null>(null);
  const [cookiesText, setCookiesText] = useState("");
  const [cookiesFileName, setCookiesFileName] = useState<string | null>(null);
  const [cookiesMessage, setCookiesMessage] = useState<{ userId: string; text: string } | null>(null);

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminUsers();
      setUsers(res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listAdminUsers(nextCursor);
      setUsers((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more users.");
    } finally {
      setLoadingMore(false);
    }
  }

  function startEdit(user: AdminUser) {
    setEditingUserId(user.userId);
    setEditingValue(String(user.credits));
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditingValue("");
  }

  async function saveEdit(userId: string) {
    const parsed = Number(editingValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Credits must be a non-negative whole number.");
      return;
    }
    setSavingUserId(userId);
    setError(null);
    try {
      const updated = await updateUserCredits(userId, parsed);
      setUsers((prev) => prev.map((u) => (u.userId === userId ? updated : u)));
      setEditingUserId(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update credits."
      );
    } finally {
      setSavingUserId(null);
    }
  }

  async function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setExpandedDownloads(null);
      return;
    }
    setExpandedUserId(userId);
    setExpandedDownloads(null);
    setExpandedError(null);
    setExpandedLoading(true);
    setCookiesText("");
    setCookiesFileName(null);
    setCookiesMessage(null);
    try {
      const res = await getUserDownloads(userId);
      setExpandedDownloads(res.items);
    } catch (err) {
      setExpandedError(err instanceof Error ? err.message : "Failed to load downloads.");
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleResetPassword(userId: string) {
    if (!window.confirm("Reset this user's password? They'll need to use 'Forgot password' to set a new one.")) {
      return;
    }
    setResetBusyUserId(userId);
    setResetMessage(null);
    try {
      await adminResetUserPassword(userId);
      setResetMessage({ userId, text: "Password reset. Tell the user to use 'Forgot password' on the login page." });
    } catch (err) {
      setResetMessage({ userId, text: err instanceof Error ? err.message : "Failed to reset password." });
    } finally {
      setResetBusyUserId(null);
    }
  }

  function handleCookiesFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCookiesMessage(null);
    if (file.size > MAX_COOKIES_BYTES) {
      setCookiesMessage({ userId: file.name, text: "That file is too large (max 100KB)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCookiesText(String(reader.result ?? ""));
      setCookiesFileName(file.name);
    };
    reader.readAsText(file);
  }

  async function handleCookiesSave(userId: string) {
    if (!cookiesText.trim()) return;
    setCookiesBusyUserId(userId);
    setCookiesMessage(null);
    try {
      await adminSetUserCookies(userId, cookiesText);
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, hasCookies: true } : u)));
      setCookiesText("");
      setCookiesFileName(null);
      setCookiesMessage({ userId, text: "Cookies saved for this user." });
    } catch (err) {
      setCookiesMessage({ userId, text: err instanceof Error ? err.message : "Failed to save cookies." });
    } finally {
      setCookiesBusyUserId(null);
    }
  }

  async function handleCookiesRemove(userId: string) {
    setCookiesBusyUserId(userId);
    setCookiesMessage(null);
    try {
      await adminDeleteUserCookies(userId);
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, hasCookies: false } : u)));
      setCookiesMessage({ userId, text: "Cookies removed for this user." });
    } catch (err) {
      setCookiesMessage({ userId, text: err instanceof Error ? err.message : "Failed to remove cookies." });
    } finally {
      setCookiesBusyUserId(null);
    }
  }

  return (
    <div className="page page--admin">
      <AdminHeader />
      <main className="container">
        <section className="card">
          <h2>Users</h2>
          {error && <div className="alert alert--error">{error}</div>}

          {loading ? (
            <p>Loading...</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Credits</th>
                    <th>Used</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <Fragment key={user.userId}>
                      <tr>
                        <td>{user.email}</td>
                        <td>
                          {editingUserId === user.userId ? (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="credits-input"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                            />
                          ) : (
                            user.credits
                          )}
                        </td>
                        <td>{user.creditsUsed}</td>
                        <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td className="table__actions">
                          {editingUserId === user.userId ? (
                            <>
                              <button
                                className="btn btn--small btn--primary"
                                onClick={() => saveEdit(user.userId)}
                                disabled={savingUserId === user.userId}
                              >
                                {savingUserId === user.userId ? "Saving..." : "Save"}
                              </button>
                              <button className="btn btn--small btn--ghost" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn btn--small"
                                onClick={() => startEdit(user)}
                              >
                                Edit credits
                              </button>
                              <button
                                className="btn btn--small btn--ghost"
                                onClick={() => toggleExpand(user.userId)}
                              >
                                {expandedUserId === user.userId ? "Hide details" : "Details"}
                              </button>
                              <button
                                className="btn btn--small btn--ghost"
                                onClick={() => handleResetPassword(user.userId)}
                                disabled={resetBusyUserId === user.userId}
                              >
                                {resetBusyUserId === user.userId ? "Resetting..." : "Reset password"}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {resetMessage?.userId === user.userId && (
                        <tr>
                          <td colSpan={5} className="table__expanded">
                            <p className="hint">{resetMessage.text}</p>
                          </td>
                        </tr>
                      )}
                      {expandedUserId === user.userId && (
                        <tr>
                          <td colSpan={5} className="table__expanded">
                            <div className="admin-user-cookies">
                              <h3>YouTube cookies</h3>
                              <p className="hint">
                                Status:{" "}
                                {user.hasCookies ? (
                                  <strong>uploaded</strong>
                                ) : (
                                  <span>none uploaded</span>
                                )}
                              </p>
                              <div className="cookies-form">
                                <input
                                  type="file"
                                  accept=".txt"
                                  onChange={handleCookiesFile}
                                  disabled={cookiesBusyUserId === user.userId}
                                />
                                {cookiesFileName && <span className="hint">Selected: {cookiesFileName}</span>}
                                <div className="cookies-form__actions">
                                  <button
                                    className="btn btn--small"
                                    type="button"
                                    disabled={cookiesBusyUserId === user.userId || !cookiesText.trim()}
                                    onClick={() => handleCookiesSave(user.userId)}
                                  >
                                    {cookiesBusyUserId === user.userId ? "Saving..." : "Save cookies"}
                                  </button>
                                  {user.hasCookies && (
                                    <button
                                      className="btn btn--small btn--danger"
                                      type="button"
                                      disabled={cookiesBusyUserId === user.userId}
                                      onClick={() => handleCookiesRemove(user.userId)}
                                    >
                                      Remove cookies
                                    </button>
                                  )}
                                </div>
                              </div>
                              {cookiesMessage?.userId === user.userId && (
                                <p className="hint">{cookiesMessage.text}</p>
                              )}
                            </div>

                            <h3>Download history</h3>
                            {expandedLoading && <p>Loading downloads...</p>}
                            {expandedError && (
                              <div className="alert alert--error">{expandedError}</div>
                            )}
                            {expandedDownloads && expandedDownloads.length === 0 && (
                              <p className="hint">No downloads for this user yet.</p>
                            )}
                            {expandedDownloads && expandedDownloads.length > 0 && (
                              <table className="table table--nested">
                                <thead>
                                  <tr>
                                    <th>Video URL</th>
                                    <th>Status</th>
                                    <th>Requested</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedDownloads.map((d) => (
                                    <tr key={d.downloadId}>
                                      <td className="table__url" title={d.videoUrl}>
                                        {d.title ?? d.videoUrl}
                                      </td>
                                      <td>
                                        <span
                                          className={`status-badge status-badge--${d.status.toLowerCase()}`}
                                        >
                                          {d.status}
                                        </span>
                                      </td>
                                      <td>{new Date(d.requestedAt).toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor && (
            <button className="btn" onClick={handleLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
