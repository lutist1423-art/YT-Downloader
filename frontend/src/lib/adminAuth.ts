// Promise-based wrapper around amazon-cognito-identity-js for the admin
// user pool. No self-signup; admins are created out-of-band by an operator
// via AWS CLI with a temporary password. TOTP MFA is mandatory pool-wide.
//
// First-ever login for a brand new admin walks through this sequence:
//   1. authenticateUser -> newPasswordRequired  (operator-set temp password)
//   2. completeNewPasswordChallenge -> mfaSetup (no TOTP device registered yet)
//   3. associateSoftwareToken -> secret code (render as text + QR)
//   4. verifySoftwareToken(code) -> SUCCESS (this single call both registers
//      the device AND completes sign-in - see amazon-cognito-identity-js
//      source: it internally responds to the MFA_SETUP challenge and returns
//      the final session via onSuccess).
//
// Every subsequent login (TOTP already configured) instead goes:
//   1. authenticateUser -> totpRequired
//   2. sendMFACode(code, ..., 'SOFTWARE_TOKEN_MFA') -> SUCCESS
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
  IAuthenticationCallback,
} from "amazon-cognito-identity-js";

const adminPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_ADMIN_POOL_ID,
  ClientId: import.meta.env.VITE_ADMIN_POOL_CLIENT_ID,
});

export function getAdminPool(): CognitoUserPool {
  return adminPool;
}

export class CognitoAuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "CognitoAuthError";
    this.code = code;
  }
}

function toAuthError(err: unknown): CognitoAuthError {
  const anyErr = err as { message?: string; code?: string } | undefined;
  return new CognitoAuthError(anyErr?.message ?? "Unknown authentication error", anyErr?.code);
}

/** Discriminated union describing where the admin sign-in flow currently stands. */
export type AdminAuthResult =
  | { status: "SUCCESS"; session: CognitoUserSession }
  | { status: "NEW_PASSWORD_REQUIRED"; cognitoUser: CognitoUser }
  | { status: "MFA_SETUP"; cognitoUser: CognitoUser }
  | { status: "TOTP_REQUIRED"; cognitoUser: CognitoUser };

function buildChallengeCallback(
  cognitoUser: CognitoUser,
  resolve: (result: AdminAuthResult) => void,
  reject: (err: CognitoAuthError) => void
): IAuthenticationCallback {
  return {
    onSuccess: (session) => resolve({ status: "SUCCESS", session }),
    onFailure: (err) => reject(toAuthError(err)),
    newPasswordRequired: () => resolve({ status: "NEW_PASSWORD_REQUIRED", cognitoUser }),
    mfaSetup: () => resolve({ status: "MFA_SETUP", cognitoUser }),
    totpRequired: () => resolve({ status: "TOTP_REQUIRED", cognitoUser }),
  };
}

function buildCognitoAdminUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: adminPool });
}

/** Step 1: kick off admin sign-in with email + password. */
export function adminSignIn(email: string, password: string): Promise<AdminAuthResult> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoAdminUser(email);
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    cognitoUser.authenticateUser(
      authDetails,
      buildChallengeCallback(cognitoUser, resolve, reject)
    );
  });
}

/** Handles the newPasswordRequired challenge (operator-created temp password). */
export function adminCompleteNewPassword(
  cognitoUser: CognitoUser,
  newPassword: string
): Promise<AdminAuthResult> {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(
      newPassword,
      {},
      buildChallengeCallback(cognitoUser, resolve, reject)
    );
  });
}

/** Handles the totpRequired challenge (TOTP already configured on this admin). */
export function adminSendMfaCode(
  cognitoUser: CognitoUser,
  code: string
): Promise<AdminAuthResult> {
  return new Promise((resolve, reject) => {
    cognitoUser.sendMFACode(
      code,
      {
        onSuccess: (session) => resolve({ status: "SUCCESS", session }),
        onFailure: (err) => reject(toAuthError(err)),
      },
      "SOFTWARE_TOKEN_MFA"
    );
  });
}

/** Step (mfaSetup): request a fresh TOTP secret to associate with this admin. */
export function adminAssociateSoftwareToken(cognitoUser: CognitoUser): Promise<string> {
  return new Promise((resolve, reject) => {
    cognitoUser.associateSoftwareToken({
      associateSecretCode: (secretCode) => resolve(secretCode),
      onFailure: (err) => reject(toAuthError(err)),
    });
  });
}

/**
 * Step (mfaSetup continued): verify the 6-digit code from the admin's
 * authenticator app. On success this single call both registers the TOTP
 * device AND completes sign-in (per amazon-cognito-identity-js internals),
 * so the result is always a completed session.
 */
export function adminVerifySoftwareToken(
  cognitoUser: CognitoUser,
  code: string
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    cognitoUser.verifySoftwareToken(code, "yt-downloader", {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(toAuthError(err)),
    });
  });
}

export function adminLogout(): void {
  const cognitoUser = adminPool.getCurrentUser();
  if (cognitoUser) {
    cognitoUser.signOut();
  }
}

export function getCurrentAdminUser(): CognitoUser | null {
  return adminPool.getCurrentUser();
}

export function getAdminSession(): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const cognitoUser = adminPool.getCurrentUser();
    if (!cognitoUser) {
      reject(new CognitoAuthError("No current admin user", "NoCurrentUser"));
      return;
    }
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        reject(toAuthError(err ?? { message: "Invalid session", code: "InvalidSession" }));
        return;
      }
      resolve(session);
    });
  });
}

export async function getValidAdminIdToken(): Promise<string> {
  const session = await getAdminSession();
  return session.getIdToken().getJwtToken();
}

export function isAdminLoggedIn(): boolean {
  return adminPool.getCurrentUser() !== null;
}
