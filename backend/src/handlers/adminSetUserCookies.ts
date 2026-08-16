import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { s3 } from "../lib/s3";
import { json, errorResponse } from "../lib/http";

const USER_COOKIES_BUCKET = process.env.USER_COOKIES_BUCKET_NAME as string;
const MAX_COOKIES_BYTES = 100 * 1024;

/** Lets an admin set cookies on behalf of a user (e.g. to help a less technical user get set up). */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

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

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: "SET hasCookies = :true",
        ConditionExpression: "attribute_exists(userId)",
        ExpressionAttributeValues: { ":true": true },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return errorResponse(404, "USER_NOT_FOUND", "User not found.");
    }
    throw err;
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: USER_COOKIES_BUCKET,
      Key: `${userId}.txt`,
      Body: cookies,
      ContentType: "text/plain",
    })
  );

  return json(200, { hasCookies: true });
}
