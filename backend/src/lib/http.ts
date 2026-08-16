import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
};

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResultV2 {
  return json(statusCode, { error: code, message });
}

/**
 * Extracts the Cognito `sub` (unique user id) and email from the JWT claims
 * that API Gateway's Cognito JWT authorizer attaches to the request context.
 */
export function getClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer): {
  sub: string;
  email: string;
} {
  const claims = event.requestContext.authorizer.jwt.claims;
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
  };
}
