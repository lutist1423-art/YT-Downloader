import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgotPassword } from "../lib/userAuth";

export default function ForgotPassword(): JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email);
      navigate("/reset-password", { state: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Forgot password</h1>
        <p className="auth-card__subtitle">
          We'll send a password reset code to your email address.
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

        <button className="btn btn--primary" type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send reset code"}
        </button>

        <p className="auth-card__footer">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
