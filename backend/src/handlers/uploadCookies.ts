import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { s3 } from "../lib/s3";
import { getClaims, json, errorResponse } from "../lib/http";

const USER_COOKIES_BUCKET = process.env.USER_COOKIES_BUCKET_NAME as string;
const MAX_COOKIES_BYTES = 100 * 1024; // cookies.txt files are typically a few KB

/**
 * Lets a user upload their own YouTube session cookies (Netscape
 * cookies.txt format) so the download worker can use them instead of (or
 * as a supplement to) the operator-wide fallback cookie set. Write-only:
 * there is no corresponding GET, the content is never returned through the
 * API once stored.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const { sub } = getClaims(event);

  let body: { cookies?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const cookies = body.cookies;
  if (!cookies || typeof cookies !== "string" || !cookies.trim()) {
    return errorResponse(400, "INVALID_COOKIES", "cookies must be a non-empty string.");
  }
  if (Buffer.byteLength(cookies, "utf8") > MAX_COOKIES_BYTES) {
    return errorResponse(400, "COOKIES_TOO_LARGE", `cookies must be under ${MAX_COOKIES_BYTES} bytes.`);
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: USER_COOKIES_BUCKET,
      Key: `${sub}.txt`,
      Body: cookies,
      ContentType: "text/plain",
    })
  );

  await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: sub },
      UpdateExpression: "SET hasCookies = :true",
      ExpressionAttributeValues: { ":true": true },
    })
  );

  return json(200, { hasCookies: true });
}
