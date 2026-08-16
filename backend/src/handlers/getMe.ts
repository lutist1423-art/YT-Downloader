import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { getClaims, json, errorResponse } from "../lib/http";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const { sub } = getClaims(event);

  const result = await ddb.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { userId: sub } })
  );

  if (!result.Item) {
    return errorResponse(404, "USER_NOT_FOUND", "User profile not found yet. Please try again shortly.");
  }

  return json(200, result.Item);
}
