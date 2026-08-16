// Shared TS types matching the backend API contract.

export interface Me {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
  hasCookies?: boolean;
}

export type DownloadStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type DownloadFormat = "mp4" | "mp3";
export type DownloadQuality = "best" | "1080p" | "720p" | "480p" | "360p";

export interface Download {
  downloadId: string;
  userId: string;
  videoUrl: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  status: DownloadStatus;
  requestedAt: string;
  completedAt?: string;
  title?: string;
  errorMessage?: string;
}

export interface DownloadDetail extends Download {
  downloadUrl?: string;
}

export interface DownloadsListResponse {
  items: Download[];
}

export interface CreateDownloadRequest {
  videoUrl: string;
  format: DownloadFormat;
  quality: DownloadQuality;
}

export interface UploadCookiesRequest {
  cookies: string;
}

export interface AdminUser {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
  hasCookies?: boolean;
}

export interface AdminUsersListResponse {
  items: AdminUser[];
  nextCursor?: string;
}

export interface UpdateCreditsRequest {
  credits: number;
}

// Error response shapes returned by the API.
export interface ApiErrorBody {
  error?: string;
  message?: string;
}
