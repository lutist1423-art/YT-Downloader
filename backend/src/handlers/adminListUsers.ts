import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { json } from "../lib/http";

/**
 * Lists all registered users for the admin dashboard. Uses a table Scan,
 * which is fine at the small-to-medium user counts this app targets; if the
 * user base grows large, paginate via ExclusiveStartKey/LastEvaluatedKey
 * (already threaded through as a `cursor` query param below) or move to a
 * dedicated query pattern.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const cursor = event.queryStringParameters?.cursor;

  const result = await ddb.send(
    new ScanCommand({
      TableName: USERS_TABLE,
      Limit: 100,
      ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) : undefined,
    })
  );

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
    : undefined;

  return json(200, { items: result.Items ?? [], nextCursor });
}
