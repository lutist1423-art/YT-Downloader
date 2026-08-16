import { SQSClient } from "@aws-sdk/client-sqs";

export const sqs = new SQSClient({});
export const DOWNLOAD_QUEUE_URL = process.env.DOWNLOAD_QUEUE_URL as string;
