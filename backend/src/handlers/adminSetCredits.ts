import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { json, errorResponse } from "../lib/http";

/**
 * Sets a user's credit balance to an absolute value chosen by the admin
 * (i.e. "grant/adjust credits" from the spec). Does not touch creditsUsed.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

  let body: { credits?: number };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  if (
    typeof body.credits !== "number" ||
    !Number.isInteger(body.credits) ||
    body.credits < 0 ||
    body.credits > 100000
  ) {
    return errorResponse(400, "INVALID_CREDITS", "credits must be a non-negative integer.");
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: "SET credits = :credits",
        ConditionExpression: "attribute_exists(userId)",
        ExpressionAttributeValues: { ":credits": body.credits },
        ReturnValues: "ALL_NEW",
      })
    );
    return json(200, result.Attributes);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return errorResponse(404, "USER_NOT_FOUND", "User not found.");
    }
    throw err;
  }
}
