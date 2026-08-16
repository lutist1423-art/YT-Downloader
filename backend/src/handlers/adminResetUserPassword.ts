import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  AdminResetUserPasswordCommand,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { json, errorResponse } from "../lib/http";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID as string;

/**
 * Invalidates the user's current password (Cognito puts them in
 * RESET_REQUIRED state). No new password is set here - the user completes
 * the reset themselves via the existing self-service "Forgot password" flow
 * (ForgotPassword.tsx / ResetPassword.tsx), which already handles exactly
 * this Cognito state.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  const userId = event.pathParameters?.userId;
  if (!userId) {
    return errorResponse(400, "MISSING_USER_ID", "userId path parameter is required.");
  }

  try {
    await cognito.send(
      new AdminResetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: userId })
    );
  } catch (err) {
    if (err instanceof UserNotFoundException) {
      return errorResponse(404, "USER_NOT_FOUND", "User not found.");
    }
    throw err;
  }

  return json(200, {
    message: "Password reset. The user must use 'Forgot password' on the login page to set a new one.",
  });
}
