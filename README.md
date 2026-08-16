# YT-Downloader

A credit-gated YouTube downloader web app on AWS. Users register, verify
their email, and can only download videos once an admin has granted them
credits. Every download is logged server-side. Admin access is a fully
separate Cognito identity pool with mandatory TOTP MFA.

> **Copyright notice.** This app is a tool. It does not grant any rights to
> the videos it downloads. Users of this app are solely responsible for
> ensuring they have the right to download and use any video they submit
> (e.g. it's their own content, licensed for reuse, or covered by an
> applicable copyright exception in their jurisdiction). This is also shown
> as a permanent notice in the app UI itself.

## Architecture

```
                          ┌─────────────────────────┐
                          │  Route53 (dillydally.ch) │
                          │  download.dillydally.ch  │
                          └───────────┬──────────────┘
                                      │ ALIAS
                          ┌───────────▼──────────────┐
                          │   CloudFront (ACM cert,   │
                          │   us-east-1)              │
                          └───────────┬──────────────┘
                                      │ OAC
                          ┌───────────▼──────────────┐
                          │  S3 (React SPA, private)  │
                          └────────────────────────────┘

  Browser ──fetch──▶ API Gateway (HTTP API)
                        │            │
              JWT authorizer   JWT authorizer
              (User Pool)      (Admin Pool, MFA required)
                        │            │
              ┌─────────▼──┐  ┌──────▼───────────┐
              │ User Lambdas│  │ Admin Lambdas     │
              │ getMe        │  │ listUsers         │
              │ createDownload│ │ setCredits        │
              │ listDownloads│  │ listUserDownloads │
              │ getDownload  │  └───────────────────┘
              └──────┬───────┘
                     │ conditional atomic credit
                     │ decrement + rate limit
                     ▼
              DynamoDB: Users, Downloads, RateLimits
                     │
                     │ SQS SendMessage
                     ▼
              SQS DownloadQueue ──▶ DLQ (after 3 failed attempts)
                     │
                     ▼
     Worker Lambda (container image: yt-dlp + ffmpeg)
                     │
                     ▼
     S3 ProcessedVideos (private, ~1h retention via
     scheduled cleanup Lambda + 1-day lifecycle backstop)
                     │
                     ▼
     Presigned GET URL returned to the user (15 min TTL)
```

Two entirely separate Cognito User Pools back the two authorizers:

- **User Pool** — self-signup, email verification required before login,
  password reset flow, no MFA.
- **Admin Pool** — no self-signup; admins are provisioned out-of-band via
  `scripts/create-admin.sh`. TOTP MFA (Google Authenticator/Authy
  compatible) is mandatory for every admin sign-in — this is enforced at
  the pool level, not by a flag on a regular user.

Credits are checked and decremented in a single atomic, conditional
DynamoDB `UpdateItem` (`credits > 0`) at request time, before the job is
enqueued — this avoids a race between two concurrent requests both passing
a separate read-then-write check. If the async worker ultimately fails the
download (invalid/private/region-blocked video, etc.), the credit is
refunded automatically.

## Project structure

```
infra/     AWS CDK (TypeScript) — all infrastructure as code
backend/   Node.js/TypeScript Lambda handlers (API + Cognito trigger + cleanup)
worker/    Python container-image Lambda (yt-dlp + ffmpeg) for the async download job
frontend/  React + Vite + TypeScript SPA
scripts/   Operational scripts (e.g. creating the first admin user)
.github/workflows/
  bootstrap-aws.yml   one-time: cdk bootstrap + first cdk deploy, using temporary IAM user keys
  deploy-infra.yml    ongoing: cdk deploy on infra/backend/worker changes, via GitHub OIDC
  deploy-frontend.yml ongoing: build + S3 sync + CloudFront invalidation, via GitHub OIDC
```

## Prerequisites

- An AWS account you control, with an existing Route 53 **public hosted
  zone for `dillydally.ch`** in that account (the stack looks it up by
  domain name and adds records for `download.dillydally.ch` to it —
  ACM DNS validation + a CloudFront alias).
- Node.js 22+ and Docker locally if you want to `cdk synth`/`cdk deploy`
  from your own machine instead of via GitHub Actions.
- Nothing else needs to be pre-created — Cognito pools, DynamoDB tables,
  S3 buckets, SQS queues, the ACM certificate, and the GitHub OIDC IAM
  roles are all created by `cdk deploy`.

## Deploying (recommended path: GitHub Actions, no long-lived AWS keys)

This mirrors the "bootstrap once with temporary keys, then use OIDC
forever" pattern:

### 1. One-time bootstrap

1. In the AWS Console, create a temporary IAM user with programmatic
   access and `AdministratorAccess` (needed once, to create IAM roles,
   Cognito pools, etc. — you can delete this user right after step 3).
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions
   → Secrets** and add:
   - `AWS_BOOTSTRAP_ACCESS_KEY_ID`
   - `AWS_BOOTSTRAP_SECRET_ACCESS_KEY`
3. Run the **"Bootstrap AWS infra (one-time)"** workflow
   (`.github/workflows/bootstrap-aws.yml`) via **Actions → Run workflow**.
   It runs `cdk bootstrap` for `eu-central-1` and `us-east-1`, then
   `cdk deploy --all`, and prints all stack outputs in the job summary.
4. **Delete the temporary IAM user** (or at least the access key) and
   remove the two `AWS_BOOTSTRAP_*` secrets from the repo. From here on,
   deploys use federated GitHub OIDC roles that `cdk deploy` just created
   — no more long-lived AWS credentials anywhere.

### 2. Wire up the ongoing-deploy workflows

From the bootstrap job's output (job summary or logs), copy these values
into **Settings → Secrets and variables → Actions → Variables**:

| Repo variable                | CDK output                |
| ----------------------------- | -------------------------- |
| `AWS_INFRA_DEPLOY_ROLE_ARN`   | `InfraDeployRoleArnOut`    |
| `AWS_DEPLOY_ROLE_ARN`         | `FrontendDeployRoleArnOut` |
| `AWS_SITE_BUCKET`             | `SiteBucketNameOut`        |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `DistributionIdOut`     |
| `VITE_API_URL`                | `ApiEndpoint`              |
| `VITE_USER_POOL_ID`           | `UserPoolIdOut`            |
| `VITE_USER_POOL_CLIENT_ID`    | `UserPoolClientIdOut`      |
| `VITE_ADMIN_POOL_ID`          | `AdminPoolIdOut`           |
| `VITE_ADMIN_POOL_CLIENT_ID`   | `AdminPoolClientIdOut`     |
| `VITE_AWS_REGION`             | `eu-central-1` (literal)   |

### 3. Deploy the frontend

Push to `main` (or run **"Deploy download.dillydally.ch"** manually) —
`deploy-frontend.yml` builds the Vite app with those `VITE_*` variables and
publishes it to S3 + invalidates CloudFront.

Any future change to `infra/`, `backend/`, or `worker/` on `main`
auto-deploys via `deploy-infra.yml`. Any future change to `frontend/`
auto-deploys via `deploy-frontend.yml`.

### 4. Create your first admin

```bash
./scripts/create-admin.sh you@example.com eu-central-1
```

This calls `AdminCreateUser` on the admin pool (the only way an admin
account can ever be created — there is no admin self-signup). It prints a
temporary password. Log in at `https://download.dillydally.ch/admin/login`,
set a new password, then scan the TOTP QR code with Google
Authenticator/Authy to finish MFA setup — the pool will not let you in
without it.

### 5. Grant a user credits

Register a normal account at `https://download.dillydally.ch/register`,
verify the email, then in the admin dashboard set that user's credit
balance. Until then they have 0 credits and downloads are blocked with a
"contact an admin" message.

### 6. YouTube cookies (needed for downloads to actually work)

YouTube increasingly blocks download requests from datacenter/cloud IPs
(including Lambda) with a "Sign in to confirm you're not a bot" error unless
yt-dlp presents cookies from a real, signed-in browser session. Two layers:

- **Per-user (self-service):** each user can upload their own
  `cookies.txt` on their dashboard (`YouTube cookies` section) - stored
  privately per user in S3, used only for their own downloads, never
  readable back through the API. This is the primary mechanism and needs
  no operator action.
- **Site-wide fallback (optional):** for users who haven't uploaded their
  own, the worker falls back to one operator-provided cookie set stored in
  Secrets Manager (`CookiesSecretNameOut` in the stack outputs). To set it:
  1. In a browser, sign in to a **secondary/throwaway** Google account (not
     your main one - see the security note below) and export cookies via
     an extension like "Get cookies.txt LOCALLY".
  2. `aws secretsmanager put-secret-value --secret-id <CookiesSecretNameOut> --secret-string file://cookies.txt --region eu-central-1`

Either way, the cookies belong to whichever Google account exported them -
treat them like a password. Anyone with access to read them could act as
that YouTube session for as long as the cookies stay valid, which is why
the app never exposes uploaded cookies back through any API response and
strongly suggests a secondary account rather than a personal one.

## Local development

```bash
# Frontend against an already-deployed backend
cd frontend
cp .env.example .env.local   # fill in the VITE_* values from the table above
npm install
npm run dev

# Infra — synth/diff locally (needs AWS credentials with read access at least)
cd infra
npm install
npx cdk synth
```

## Cost notes

Everything is pay-per-use serverless (DynamoDB on-demand, Lambda,
API Gateway HTTP API, SQS) except:

- CloudFront + Route53 (small fixed cost, essentially cents/month at low
  traffic).
- The worker Lambda uses a container image and up to 2GB memory /
  4GB ephemeral storage while a download is actively processing — cost is
  proportional to actual usage (`reservedConcurrentExecutions: 2` caps
  how many run in parallel).
- No NAT Gateway / VPC is used anywhere, since no Lambda needs to reach
  private resources — this avoids the ~$32/month NAT Gateway fixed cost.

## Security notes

- Least-privilege IAM: every Lambda only has `grant*` access to the
  specific DynamoDB tables/S3 buckets/SQS queues it actually touches (see
  `infra/lib/constructs/*.ts`).
- Per-user rate limiting is enforced server-side in `createDownload` via an
  atomic conditional DynamoDB counter (default: 5 requests/60s/user,
  configurable via Lambda env vars), independent of any client behavior.
- Every download request is logged in the `Downloads` DynamoDB table
  (`userId`, `videoUrl`, `status`, timestamps) and all Lambdas ship logs to
  CloudWatch.
- GitHub Actions never holds long-lived AWS credentials after the
  one-time bootstrap step — both deploy workflows use OIDC-federated,
  repo-and-branch-scoped IAM roles (see `infra/lib/constructs/cicd.ts`).
  The infra-deploy role is restricted to only `sts:AssumeRole` on the CDK
  bootstrap roles, never holding direct service permissions itself.

## Known limitations / possible follow-ups

- The API stays on its default `execute-api.amazonaws.com` domain rather
  than a custom subdomain — only the frontend uses the custom domain, to
  avoid a second ACM cert + Route53 wiring for an MVP.
- S3 lifecycle rules only support whole-day granularity, so the ~1 hour
  processed-video retention target is enforced by a scheduled cleanup
  Lambda (every 15 min) rather than the lifecycle rule alone (which stays
  as a 1-day backstop).
- Admin user listing uses a DynamoDB `Scan` with pagination — fine at
  small/medium user counts; consider a dedicated index if the user base
  grows very large.
- The worker's ffmpeg binary is pulled from a third-party static build
  mirror at image-build time (`worker/Dockerfile`) since Amazon Linux's
  base repos don't ship ffmpeg — pin/vendor it if you need fully
  reproducible builds.
