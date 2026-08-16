import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddb, DOWNLOADS_TABLE } from "../lib/dynamo";
import { s3 } from "../lib/s3";
import { getClaims, json, errorResponse } from "../lib/http";
import { DownloadRecord } from "../lib/types";

const PROCESSED_VIDEOS_BUCKET = process.env.PROCESSED_VIDEOS_BUCKET_NAME as string;
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const { sub } = getClaims(event);
  const downloadId = event.pathParameters?.id;
  if (!downloadId) {
    return errorResponse(400, "MISSING_ID", "downloadId path parameter is required.");
  }

  const result = await ddb.send(
    new GetCommand({ TableName: DOWNLOADS_TABLE, Key: { downloadId } })
  );
  const record = result.Item as DownloadRecord | undefined;

  if (!record || record.userId !== sub) {
    return errorResponse(404, "NOT_FOUND", "Download not found.");
  }

  let downloadUrl: string | undefined;
  if (record.status === "COMPLETED" && record.s3Key) {
    downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: PROCESSED_VIDEOS_BUCKET, Key: record.s3Key }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
    );
  }

  return json(200, { ...record, downloadUrl });
}
