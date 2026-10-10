# Stripe V2 — isolated sandbox ledger infrastructure

**Source-only; no deployment made. Creating these tables later incurs AWS charges.** The existing AWS root-connected account, Products and Inventory tables were NOT changed when this template was added.

`aws/stripe-v2-ledgers/template.yaml` is an independent sandbox CloudFormation/SAM foundation containing **only** two empty DynamoDB tables with random CloudFormation-managed names:

- `StripeTestEventLedger`: string partition key `eventId` for future signed Stripe webhook replay deduplication; expected records include event fingerprint, immutable orderId and settlement state. No event source or write permission is included.
- `StripeTestCheckoutRequestLedger`: string partition key `requestId` for durable idempotent cart/checkout attempts. No Stripe Session calls or order creation are included.

**Both tables:** PAY_PER_REQUEST, encryption at rest, PITR enabled, `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`, with NO TTL. Retry idempotency history must not quietly expire. Real retention/deletion and PII policy requires merchant approval; keep customer names, addresses, emails and card details OUT of the two ledgers.

**Explicit non-activation:** `EnableStripeCheckout` defaults to and ONLY permits the literal string `'false'`. Stage only permits `sandbox`. No API Gateway, Lambda, IAM role/policy, secret, webhook, permissions, stock action or session creation resources exist in this stack. Outputs are names/ARNs of empty tables only; they cannot receive webhook events without separate future code.

This is deliberately NOT the future orders table (see `aws/order-ops/template.yaml`) nor the independent Stock V2 table (see `aws/stock-v2/template.yaml`). Deploying these ledgers alone cannot make a paid order safe. Original Products and Inventory are keyed by physical productId, NOT SKU.

## Prerequisites to first deployment

1. Explicit owner approval to create **billable isolated sandbox DynamoDB tables**.
2. A reviewed least-privilege GitHub OIDC deployment policy and CloudFormation execution role. `HobbyHubStagingDeploy` currently authenticates but has **zero AWS resource permissions**.
3. A staging stack name that is different from `hobbyhub` (example `hobbyhub-stripe-sandbox-ledgers`) and region **us-east-2**.
4. Review names/ARNs and retention impact, CloudFormation change set, cost budget, and ensure no legacy table mutation.
5. After approval, verify new tables are EMPTY, have correct keys, SSE, PITR, retention, and contain no customer PII. Do not configure Stripe webhooks, enable checkout, initialize original stock or purchase labels merely because these empty tables exist.

## Workflow

Unit test: `node --test tests/stripe-v2-ledgers-template.test.mjs`. The GitHub AWS SAM validation workflow lints **all** `aws/**/template.yaml` files offline and does not run `sam deploy`. See `docs/STRIPE_STAGE_DEPLOY_AND_TEST_PLAN.md`.
