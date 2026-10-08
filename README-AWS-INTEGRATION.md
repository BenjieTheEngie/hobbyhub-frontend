# Hobby Hub AWS backend add-on — staging integration package

This is deployable **source**, not a deployed service. It has **not** been tested against your AWS account or original DynamoDB schema. Do not run `sam deploy` against production until the checks below are complete. No live Stripe payments are enabled by this package.

## Contents

- `aws/media-addon/template.yaml`: optional AWS SAM infrastructure definitions for public catalog, admin inventory API, private media upload, CloudFront, scan recognition, and sandbox Stripe order flow.
- `backend/inventory.mjs`: admin-only product create/read/update/delete.
- `backend/catalog.mjs`: public, published-only catalog.
- `backend/handler.mjs`: guarded image upload and recognition integration.
- `backend/checkout.mjs`: Stripe sandbox Checkout and payment/order webhook logic, disabled by default.
- `backend/security.mjs`, `backend/media-helpers.mjs`, `backend/checkout-logic.mjs`: reusable security and business logic.
- `tests/`: offline regression checks.

## What needs to be supplied by the owner

1. The *existing* AWS backend SAM template or Lambda sources, plus the real DynamoDB products table name and full key schema. The adapter assumes a **single string partition key named `sku`**. This MUST be verified before deploying or writing inventory.
2. The Cognito user pool ID, admin group membership, API Gateway authorizer config, and the appropriate AWS IAM administrator to run CloudFormation/SAM. No passwords or access keys in chat.
3. Approval of S3, CloudFront, Rekognition and any optional third-party visual recognition costs; test budget alarms first.
4. For **Stripe sandbox only**: a secret key and webhook signing secret stored in AWS Secrets Manager, with their ARNs supplied to SAM. Configure verified test webhook event destinations, shipping and tax; no raw secrets in frontend or source control.
5. A staging DynamoDB table or a verified backup and rollback plan.

## Suggested sequence

- Verify all parameters and table keys in `template.yaml` with your existing stack, then run `sam validate --template-file aws/media-addon/template.yaml` and `sam build --template-file aws/media-addon/template.yaml` in an AWS-supported environment with installed SDKs.
- Deploy under a *new staging CloudFormation stack*, not as an automatic overwrite of the existing backend.
- Exercise read-only catalog, then admin CRUD, upload+publish, scanning with manually reviewed matches, and finally sandbox Checkout, webhooks and inventory concurrency.
- After staging tests, add Vercel environment variables `VITE_PUBLIC_CATALOG_URL` and `VITE_MEDIA_API_BASE_URL` and deploy a new preview, then merge only after validating the mobile UX and permissions. Never add secret credentials to `VITE_*` variables.

## Release note

The live `hobbyhub.company` frontend was separately updated via GitHub PR #2. The AWS add-on is not running until your cloud administrator deploys it to the verified target account. The current website intentionally disables payments and presents a pending catalog when no public catalog URL is configured.

## AWS discovery / preflight (read-only)

From AWS CloudShell in the account and region where Hobby Hub runs, review the `scripts/aws-preflight.sh` file before running:

```bash
bash scripts/aws-preflight.sh
```

This invokes only AWS STS, CloudFormation, Lambda, DynamoDB `ListTables`/`DescribeTable`, Cognito `ListUserPools` and API Gateway `GetApis` read operations. It does **not** inspect product data or user records, grant access, create resources or deploy the stack. It intentionally asks for the existing products table name before describing its key schema. Redact account identifiers before sharing output.

All mutating routes in `backend/inventory.mjs` are **disabled by default** (`EnableInventoryWrites=false`) until the schema is verified. DELETE becomes a reversible archive (`isactive=false`, `published=false`) rather than hard-deleting a product. Checkout requires inventory writes enabled AND the separate existing Stripe sandbox safeguards. A new stack is not automatically deployed by committing these source files.
