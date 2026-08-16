export type DownloadStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface UserRecord {
  userId: string;
  email: string;
  credits: number;
  creditsUsed: number;
  createdAt: string;
}

export interface DownloadRecord {
  downloadId: string;
  userId: string;
  videoUrl: string;
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
}
