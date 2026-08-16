import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, DOWNLOADS_TABLE } from "../lib/dynamo";
import { getClaims, json } from "../lib/http";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const { sub } = getClaims(event);

  const result = await ddb.send(
    new QueryCommand({
      TableName: DOWNLOADS_TABLE,
      IndexName: "UserIndex",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": sub },
      ScanIndexForward: false, // newest first
      Limit: 100,
    })
  );

  return json(200, { items: result.Items ?? [] });
}
