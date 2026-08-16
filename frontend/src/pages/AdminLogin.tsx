import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import type { CognitoUser } from "amazon-cognito-identity-js";
import {
  AdminAuthResult,
  adminAssociateSoftwareToken,
  adminCompleteNewPassword,
  adminSendMfaCode,
  adminSignIn,
  adminVerifySoftwareToken,
} from "../lib/adminAuth";

type Step =
  | { name: "CREDENTIALS" }
  | { name: "NEW_PASSWORD"; cognitoUser: CognitoUser }
  | { name: "MFA_SETUP"; cognitoUser: CognitoUser; secretCode: string; qrDataUrl: string }
  | { name: "TOTP"; cognitoUser: CognitoUser };

export default function AdminLogin(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ name: "CREDENTIALS" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  /** Shared handling for any result coming out of authenticateUser /
   *  completeNewPasswordChallenge, both of which can land on any challenge. */
  async function handleAuthResult(result: AdminAuthResult) {
    switch (result.status) {
      case "SUCCESS":
        navigate("/admin", { replace: true });
        return;
      case "NEW_PASSWORD_REQUIRED":
        setStep({ name: "NEW_PASSWORD", cognitoUser: result.cognitoUser });
        return;
      case "TOTP_REQUIRED":
        setStep({ name: "TOTP", cognitoUser: result.cognitoUser });
        return;
      case "MFA_SETUP": {
        const secretCode = await adminAssociateSoftwareToken(result.cognitoUser);
        const issuer = "YT-Downloader";
        const otpauthUri = `otpauth://totp/${issuer}:${encodeURIComponent(
          email
        )}?secret=${secretCode}&issuer=${issuer}`;
        const qrDataUrl = await QRCode.toDataURL(otpauthUri);
        setStep({ name: "MFA_SETUP", cognitoUser: result.cognitoUser, secretCode, qrDataUrl });
        return;
      }
    }
  }

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await adminSignIn(email, password);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPasswordSubmit(e: FormEvent, cognitoUser: CognitoUser) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const result = await adminCompleteNewPassword(cognitoUser, newPassword);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set new password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSetupSubmit(e: FormEvent, cognitoUser: CognitoUser) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminVerifySoftwareToken(cognitoUser, mfaCode);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid authenticator code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(e: FormEvent, cognitoUser: CognitoUser) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await adminSendMfaCode(cognitoUser, mfaCode);
      await handleAuthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid authenticator code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page auth-page--admin">
      <div className="auth-card">
        <h1>
          Admin login <span className="app-header__badge">Admin</span>
        </h1>

        {error && <div className="alert alert--error">{error}</div>}

        {step.name === "CREDENTIALS" && (
          <form onSubmit={handleCredentialsSubmit}>
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
          </form>
        )}

        {step.name === "NEW_PASSWORD" && (
          <form onSubmit={(e) => handleNewPasswordSubmit(e, step.cognitoUser)}>
            <p className="auth-card__subtitle">
              This is your first login. Please set a new password.
            </p>
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
              {loading ? "Saving..." : "Set new password"}
            </button>
          </form>
        )}

        {step.name === "MFA_SETUP" && (
          <form onSubmit={(e) => handleMfaSetupSubmit(e, step.cognitoUser)}>
            <p className="auth-card__subtitle">
              Set up two-factor authentication. Scan the QR code below with an authenticator app
              (e.g. Google Authenticator, 1Password, Authy), or enter the secret manually.
            </p>
            <div className="mfa-qr">
              <img src={step.qrDataUrl} alt="TOTP QR code" width={200} height={200} />
            </div>
            <p className="mfa-secret">
              Secret: <code>{step.secretCode}</code>
            </p>
            <label className="field">
              <span>Authenticator code</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </label>
            <button className="btn btn--primary" type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify and finish setup"}
            </button>
          </form>
        )}

        {step.name === "TOTP" && (
          <form onSubmit={(e) => handleTotpSubmit(e, step.cognitoUser)}>
            <p className="auth-card__subtitle">Enter the 6-digit code from your authenticator app.</p>
            <label className="field">
              <span>Authenticator code</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </label>
            <button className="btn btn--primary" type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
