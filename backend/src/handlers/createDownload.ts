import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from "uuid";
import { ddb, USERS_TABLE, DOWNLOADS_TABLE } from "../lib/dynamo";
import { sqs, DOWNLOAD_QUEUE_URL } from "../lib/sqs";
import { checkRateLimit } from "../lib/rateLimit";
import { getClaims, json, errorResponse } from "../lib/http";
import { DownloadRecord, DownloadQueueMessage } from "../lib/types";

const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const { sub } = getClaims(event);

  let body: { videoUrl?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const videoUrl = body.videoUrl?.trim();
  if (!videoUrl || !YOUTUBE_URL_PATTERN.test(videoUrl)) {
    return errorResponse(400, "INVALID_URL", "Please provide a valid YouTube video URL.");
  }

  const allowed = await checkRateLimit(sub);
  if (!allowed) {
    return errorResponse(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }

  // Atomically check-and-decrement credits in one conditional write to avoid
  // a race between two concurrent requests both passing a separate "credits > 0" read.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: sub },
        UpdateExpression: "SET credits = credits - :one, creditsUsed = creditsUsed + :one",
        ConditionExpression: "attribute_exists(userId) AND credits > :zero",
        ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return errorResponse(402, "NO_CREDITS", "You have no download credits left. Please contact an admin.");
    }
    throw err;
  }

  const downloadId = uuidv4();
  const requestedAt = new Date().toISOString();

  const record: DownloadRecord = {
    downloadId,
    userId: sub,
    videoUrl,
    status: "QUEUED",
    requestedAt,
  };

  try {
    await ddb.send(new PutCommand({ TableName: DOWNLOADS_TABLE, Item: record }));

    const message: DownloadQueueMessage = { downloadId, userId: sub, videoUrl };
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: DOWNLOAD_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      })
    );
  } catch (err) {
    // Best-effort refund if we couldn't actually enqueue the job after
    // charging the credit.
    await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: sub },
        UpdateExpression: "SET credits = credits + :one, creditsUsed = creditsUsed - :one",
        ExpressionAttributeValues: { ":one": 1 },
      })
    ).catch(() => undefined);
    throw err;
  }

  return json(201, record);
}
