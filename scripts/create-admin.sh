#!/usr/bin/env bash
# Creates an admin user in the (self-signup-disabled) admin Cognito pool.
# This is the actual security gate for "who can become an admin": only
# someone with AWS credentials for this account can run this script.
#
# Usage: ./scripts/create-admin.sh admin@example.com [aws-region]
set -euo pipefail

EMAIL="${1:?Usage: create-admin.sh <email> [aws-region]}"
REGION="${2:-eu-central-1}"
STACK_NAME="YtDownloaderAppStack"

ADMIN_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AdminPoolIdOut'].OutputValue" \
  --output text)

if [[ -z "$ADMIN_POOL_ID" || "$ADMIN_POOL_ID" == "None" ]]; then
  echo "Could not find AdminPoolIdOut in stack '$STACK_NAME' outputs (region $REGION)." >&2
  echo "Has the infra been deployed yet? See README.md for deployment steps." >&2
  exit 1
fi

TEMP_PASSWORD="$(openssl rand -base64 18)Aa1!"

aws cognito-idp admin-create-user \
  --region "$REGION" \
  --user-pool-id "$ADMIN_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS \
  >/dev/null

cat <<EOF

Admin user created in pool $ADMIN_POOL_ID.

  Email:              $EMAIL
  Temporary password: $TEMP_PASSWORD

Share this temporary password with the admin over a secure channel (not
email/Slack in plaintext). On first login at https://download.dillydally.ch/admin/login
they will be forced to set a new password, then walked through TOTP MFA
setup (scan the QR code with Google Authenticator/Authy). MFA is mandatory
for this pool — there is no way to skip it.
EOF
