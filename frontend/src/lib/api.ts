// Thin fetch wrapper around the API Gateway HTTP API described in the spec.
// All endpoints require `Authorization: <idToken>` (the raw JWT, no
// "Bearer " prefix). On 401 we redirect to the appropriate login screen
// depending on which area of the app the call originated from.
import { getValidIdToken } from "./userAuth";
import { getValidAdminIdToken } from "./adminAuth";
import type {
  AdminUsersListResponse,
  AdminUser,
  Download,
  DownloadDetail,
  DownloadFormat,
  DownloadQuality,
  DownloadsListResponse,
  Me,
  ApiErrorBody,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL.replace(/\/$/, "");

type Area = "user" | "admin";

export class ApiError extends Error {
  status: number;
  errorCode?: string;
  constructor(status: number, message: string, errorCode?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

function loginPathFor(area: Area): string {
  return area === "admin" ? "/admin/login" : "/login";
}

async function tokenFor(area: Area): Promise<string> {
  return area === "admin" ? getValidAdminIdToken() : getValidIdToken();
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

async function request<T>(area: Area, path: string, options: RequestOptions = {}): Promise<T> {
  let token: string;
  try {
    token = await tokenFor(area);
  } catch {
    // No valid session at all - go straight to login.
    window.location.href = loginPathFor(area);
    throw new ApiError(401, "Not authenticated");
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Network error - please check your connection.");
  }

  if (res.status === 401) {
    window.location.href = loginPathFor(area);
    throw new ApiError(401, "Session expired, please log in again.");
  }

  let bodyJson: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      bodyJson = JSON.parse(text);
    } catch {
      // non-JSON body, ignore
    }
  }

  if (!res.ok) {
    const errBody = (bodyJson ?? {}) as ApiErrorBody;
    throw new ApiError(
      res.status,
      errBody.message ?? errBody.error ?? `Request failed with status ${res.status}`,
      errBody.error
    );
  }

  return bodyJson as T;
}

// ---------- User-pool-authenticated endpoints ----------

export function getMe(): Promise<Me> {
  return request<Me>("user", "/me");
}

export function listDownloads(): Promise<DownloadsListResponse> {
  return request<DownloadsListResponse>("user", "/downloads");
}

export function createDownload(
  videoUrl: string,
  format: DownloadFormat,
  quality: DownloadQuality
): Promise<Download> {
  return request<Download>("user", "/downloads", { method: "POST", body: { videoUrl, format, quality } });
}

export function getDownload(downloadId: string): Promise<DownloadDetail> {
  return request<DownloadDetail>("user", `/downloads/${encodeURIComponent(downloadId)}`);
}

export function uploadCookies(cookies: string): Promise<{ hasCookies: boolean }> {
  return request<{ hasCookies: boolean }>("user", "/me/cookies", { method: "POST", body: { cookies } });
}

export function deleteCookies(): Promise<{ hasCookies: boolean }> {
  return request<{ hasCookies: boolean }>("user", "/me/cookies", { method: "DELETE" });
}

// ---------- Admin-pool-authenticated endpoints ----------

export function listAdminUsers(cursor?: string): Promise<AdminUsersListResponse> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<AdminUsersListResponse>("admin", `/admin/users${qs}`);
}

export function updateUserCredits(userId: string, credits: number): Promise<AdminUser> {
  return request<AdminUser>("admin", `/admin/users/${encodeURIComponent(userId)}/credits`, {
    method: "PATCH",
    body: { credits },
  });
}

export function getUserDownloads(userId: string): Promise<DownloadsListResponse> {
  return request<DownloadsListResponse>(
    "admin",
    `/admin/users/${encodeURIComponent(userId)}/downloads`
  );
}

export function adminResetUserPassword(userId: string): Promise<{ message: string }> {
  return request<{ message: string }>(
    "admin",
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    { method: "POST" }
  );
}

export function adminSetUserPassword(userId: string, password: string): Promise<{ message: string }> {
  return request<{ message: string }>(
    "admin",
    `/admin/users/${encodeURIComponent(userId)}/password`,
    { method: "PUT", body: { password } }
  );
}

export function adminSetUserCookies(userId: string, cookies: string): Promise<{ hasCookies: boolean }> {
  return request<{ hasCookies: boolean }>(
    "admin",
    `/admin/users/${encodeURIComponent(userId)}/cookies`,
    { method: "POST", body: { cookies } }
  );
}

export function adminDeleteUserCookies(userId: string): Promise<{ hasCookies: boolean }> {
  return request<{ hasCookies: boolean }>(
    "admin",
    `/admin/users/${encodeURIComponent(userId)}/cookies`,
    { method: "DELETE" }
  );
}
