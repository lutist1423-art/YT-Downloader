// Promise-based wrapper around amazon-cognito-identity-js for the regular
// (customer) user pool. No MFA, self-signup enabled.
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_USER_POOL_ID,
  ClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
});

export function getUserPool(): CognitoUserPool {
  return userPool;
}

/** Wraps a Cognito error so callers can branch on `.code` (e.g. UserNotConfirmedException). */
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

export function register(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attributeList = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
    ];
    userPool.signUp(email, password, attributeList, [], (err) => {
      if (err) {
        reject(toAuthError(err));
        return;
      }
      resolve();
    });
  });
}

function buildCognitoUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: userPool });
}

export function confirmRegistration(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoUser(email);
    cognitoUser.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(toAuthError(err));
        return;
      }
      resolve();
    });
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoUser(email);
    cognitoUser.resendConfirmationCode((err) => {
      if (err) {
        reject(toAuthError(err));
        return;
      }
      resolve();
    });
  });
}

export function login(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoUser(email);
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(toAuthError(err)),
    });
  });
}

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoUser(email);
    cognitoUser.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(toAuthError(err)),
    });
  });
}

export function confirmPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = buildCognitoUser(email);
    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(toAuthError(err)),
    });
  });
}

export function logout(): void {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) {
    cognitoUser.signOut();
  }
}

export function getCurrentUser(): CognitoUser | null {
  return userPool.getCurrentUser();
}

/**
 * Returns the current session, refreshing it transparently if needed.
 * Rejects if there's no logged-in user or the session cannot be refreshed.
 */
export function getCurrentSession(): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      reject(new CognitoAuthError("No current user", "NoCurrentUser"));
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

/** Returns a valid ID token (JWT string), refreshing the session if needed. */
export async function getValidIdToken(): Promise<string> {
  const session = await getCurrentSession();
  return session.getIdToken().getJwtToken();
}

export function isLoggedIn(): boolean {
  return userPool.getCurrentUser() !== null;
}
