import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, DOWNLOADS_TABLE } from "../lib/dynamo";
import { json, errorResponse } from "../lib/http";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: DOWNLOADS_TABLE,
      IndexName: "UserIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      ScanIndexForward: false,
      Limit: 200,
    })
  );

  return json(200, { items: result.Items ?? [] });
}
