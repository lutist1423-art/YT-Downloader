import { PostConfirmationTriggerEvent } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE } from "../lib/dynamo";
import { UserRecord } from "../lib/types";

/**
 * Cognito PostConfirmation_ConfirmSignUp trigger. Fires once, right after a
 * new user verifies their email address. Provisions the corresponding
 * DynamoDB Users row with zero credits — an admin must grant credits before
 * the user can download anything.
 */
export async function handler(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
  const userId = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;

  const record: UserRecord = {
    userId,
    email,
    credits: 0,
    creditsUsed: 0,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: record,
      ConditionExpression: "attribute_not_exists(userId)",
    })
  ).catch((err) => {
    // Idempotent: if the row already exists (e.g. retry), don't fail the trigger.
    if (err?.name !== "ConditionalCheckFailedException") throw err;
  });

  return event;
}
