import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { s3 } from "../lib/s3";
import { json, errorResponse } from "../lib/http";

const USER_COOKIES_BUCKET = process.env.USER_COOKIES_BUCKET_NAME as string;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

  await s3.send(new DeleteObjectCommand({ Bucket: USER_COOKIES_BUCKET, Key: `${userId}.txt` }));

  await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: "SET hasCookies = :false",
      ExpressionAttributeValues: { ":false": false },
    })
  );

  return json(200, { hasCookies: false });
}
