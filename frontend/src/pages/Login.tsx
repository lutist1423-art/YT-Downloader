import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CognitoAuthError, login } from "../lib/userAuth";

interface LocationState {
  justVerified?: boolean;
  email?: string;
  from?: { pathname: string };
}

export default function Login(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const [email, setEmail] = useState(state?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const dest = state?.from?.pathname ?? "/dashboard";
      navigate(dest, { replace: true });
    } catch (err) {
      if (err instanceof CognitoAuthError && err.code === "UserNotConfirmedException") {
        navigate("/verify-email", { state: { email } });
        return;
      }
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        <p className="auth-card__subtitle">Welcome back.</p>

        {state?.justVerified && (
          <div className="alert alert--info">Email verified - you can log in now.</div>
        )}
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
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn btn--primary" type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="auth-card__footer">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p className="auth-card__footer">
          No account yet? <Link to="/register">Register</Link>
        </p>
        <p className="auth-card__footer auth-card__footer--muted">
          <Link to="/admin/login">Admin login</Link>
        </p>
      </form>
    </div>
  );
}
