import { Navigate, Link } from "react-router-dom";
import { isLoggedIn } from "../lib/userAuth";

export default function Landing(): JSX.Element {
  if (isLoggedIn()) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>YT Downloader</h1>
        <p className="auth-card__subtitle">
          Paste a YouTube link, use one of your credits, and get a download link once it's ready.
        </p>
        <div className="landing-actions">
          <Link className="btn btn--primary" to="/login">
            Log in
          </Link>
          <Link className="btn" to="/register">
            Create account
          </Link>
        </div>
        <p className="auth-card__footer auth-card__footer--muted">
          <Link to="/admin/login">Admin login</Link>
        </p>
      </div>
    </div>
  );
}
