import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const USERS_TABLE = process.env.USERS_TABLE_NAME as string;
export const DOWNLOADS_TABLE = process.env.DOWNLOADS_TABLE_NAME as string;
export const RATE_LIMITS_TABLE = process.env.RATE_LIMITS_TABLE_NAME as string;
