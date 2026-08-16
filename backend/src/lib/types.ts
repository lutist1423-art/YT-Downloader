export type DownloadStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type DownloadFormat = "mp4" | "mp3";
export type DownloadQuality = "best" | "1080p" | "720p" | "480p" | "360p";

export interface UserRecord {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
  hasCookies?: boolean;
}

export interface DownloadRecord {
  downloadId: string;
  userId: string;
  videoUrl: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  status: DownloadStatus;
  requestedAt: string;
  completedAt?: string;
  title?: string;
  s3Key?: string;
  errorMessage?: string;
}

export interface DownloadQueueMessage {
  downloadId: string;
  userId: string;
  videoUrl: string;
  format: DownloadFormat;
  quality: DownloadQuality;
}
