import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { confirmRegistration, resendConfirmationCode } from "../lib/userAuth";

interface LocationState {
  email?: string;
}

export default function VerifyEmail(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const stateEmail = (location.state as LocationState | null)?.email ?? "";

  const [email, setEmail] = useState(stateEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await confirmRegistration(email, code);
      navigate("/login", { state: { justVerified: true, email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setResending(true);
    try {
      await resendConfirmationCode(email);
      setInfo("A new verification code has been sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Verify your email</h1>
        <p className="auth-card__subtitle">
          Enter the 6-digit code we sent to your email address.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {info && <div className="alert alert--info">{info}</div>}

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
          <span>Verification code</span>
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

        <button className="btn btn--primary" type="submit" disabled={loading}>
          {loading ? "Verifying..." : "Verify email"}
        </button>

        <button
          type="button"
          className="btn btn--link"
          onClick={handleResend}
          disabled={resending}
        >
          {resending ? "Sending..." : "Resend code"}
        </button>

        <p className="auth-card__footer">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
