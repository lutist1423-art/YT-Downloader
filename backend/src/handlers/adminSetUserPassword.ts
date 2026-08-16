import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  UserNotFoundException,
  InvalidPasswordException,
} from "@aws-sdk/client-cognito-identity-provider";
import { json, errorResponse } from "../lib/http";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID as string;

/** Lets an admin set a specific, immediately-usable password for a user. */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

  let body: { password?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const password = body.password;
  if (!password || typeof password !== "string" || password.length < 10) {
    return errorResponse(400, "INVALID_PASSWORD", "password must be at least 10 characters.");
  }

  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
        Password: password,
        Permanent: true,
      })
    );
  } catch (err) {
    if (err instanceof UserNotFoundException) {
      return errorResponse(404, "USER_NOT_FOUND", "User not found.");
    }
    if (err instanceof InvalidPasswordException) {
      return errorResponse(
        400,
        "INVALID_PASSWORD",
        "Password doesn't meet requirements: at least 10 characters, including uppercase, lowercase, and a digit."
      );
    }
    throw err;
  }

  return json(200, { message: "Password set. The user can log in with it immediately." });
}
