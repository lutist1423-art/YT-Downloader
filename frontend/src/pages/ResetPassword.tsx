import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { confirmPassword } from "../lib/userAuth";

interface LocationState {
  email?: string;
}

export default function ResetPassword(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const stateEmail = (location.state as LocationState | null)?.email ?? "";

  const [email, setEmail] = useState(stateEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await confirmPassword(email, code, newPassword);
      navigate("/login", { state: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Reset password</h1>
        <p className="auth-card__subtitle">
          Enter the code you received by email along with your new password.
        </p>

        {error && <div className="alert alert--error">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Reset code</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Confirm new password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
          />
        </label>

        <button className="btn btn--primary" type="submit" disabled={loading}>
          {loading ? "Resetting..." : "Reset password"}
        </button>

        <p className="auth-card__footer">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
