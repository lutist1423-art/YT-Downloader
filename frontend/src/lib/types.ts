// Shared TS types matching the backend API contract.

export interface Me {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
}

export type DownloadStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Download {
  downloadId: string;
  userId: string;
  videoUrl: string;
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
}

export interface AdminUser {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
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
