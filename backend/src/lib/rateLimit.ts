import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, RATE_LIMITS_TABLE } from "./dynamo";

const WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
const MAX_REQUESTS_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 5);

/**
 * Fixed-window per-user rate limit backed by a single atomic conditional
 * UpdateItem call (no read-then-write race). Each window is its own item,
 * keyed by userId + window bucket, and expires automatically via TTL.
 *
 * Returns true if the request is allowed (and has been counted), false if
 * the caller is currently rate limited.
 */
export async function checkRateLimit(userId: string): Promise<boolean> {
  const windowBucket = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const rateKey = `${userId}#${windowBucket}`;
  const expiresAt = (windowBucket + 1) * WINDOW_SECONDS + WINDOW_SECONDS; // one extra window of buffer

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: RATE_LIMITS_TABLE,
        Key: { rateKey },
        UpdateExpression: "ADD reqCount :incr SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ConditionExpression: "attribute_not_exists(reqCount) OR reqCount < :max",
        ExpressionAttributeValues: {
          ":incr": 1,
          ":max": MAX_REQUESTS_PER_WINDOW,
          ":ttl": expiresAt,
        },
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
}
