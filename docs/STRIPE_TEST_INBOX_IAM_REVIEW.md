# Proposed TEST-only Stripe webhook inbox data-plane permissions

**DRAFT — NOT ATTACHED TO ANY AWS ROLE. NO AWS DATA WAS READ OR WRITTEN TO THE EVENT LEDGER WHILE PREPARING THIS FILE.**

Existing deployed sandbox ledger in account `349744180170`, `us-east-2`:

`hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5`

The future test-only webhook Lambda needs to read an individual Stripe event ID and atomically insert the pending-review receipt after Stripe SDK signature/session/quote/tax/order validation. The proposed IAM permissions are in `aws/iam/hobbyhub-stripe-test-inbox-ddb-data-policy.json`, NOT the existing CloudFormation execution role or GitHub OIDC preview role.

The draft permits only:
- `dynamodb:GetItem` and `dynamodb:PutItem` on the **exact** sandbox event table ARN, not a name prefix.
- `dynamodb:LeadingKeys` matching `evt_*` and with `Null:false` to block missing-key context.

The draft expressly excludes `Query`, `Scan`, `UpdateItem`, `DeleteItem`, `TransactWriteItems`, other DynamoDB tables, the original Products/Inventory records, Secrets Manager, IAM, Lambda, CloudFormation and any Stripe API permissions. It does not grant read/write to the separate checkout request ledger.

## Verified AWS policy simulations (read-only, October 10, 2026)

`iam:SimulateCustomPolicy` returned:

| Example | Decision |
| --- | --- |
| GetItem `evt_abcdefgh123456` from exact test event table | **allowed** |
| PutItem `evt_abcdefgh123456` to exact test event table | **allowed** |
| PutItem with wrong `order_...` partition key | **implicitDeny** |
| PutItem missing the partition-key condition context | **implicitDeny** |
| PutItem to original Inventory table | **implicitDeny** |
| PutItem to separate checkout request ledger | **implicitDeny** |
| Scan even the allowed test event table | **implicitDeny** |

**Limitations:** An IAM policy does not prove that `PutItem` includes an `attribute_not_exists(eventId)` condition. Atomic deduplication MUST come from the trusted source `backend/stripe-test-event-inbox.mjs` and integration tests, together with the table partition key. The IAM simulator is not an end-to-end test and does not grant credentials or create an execution role.

## Must happen before attachment

1. Owner approves a separate least-privilege **test webhook Lambda execution role**, created via an independently reviewed non-root deployment path. Do not attach this draft to `HobbyHubStagingDeploy`, `HobbyHubStagingLedgerCfnExec` or any production Lambda.
2. Deploy a separate isolated **Order V2** table with strongly consistent read permissions, and a server-owned order snapshot matching the verified Stripe Session and correct reserved Stock V2. There is currently no deployable end-to-end payment/order settlement transaction.
3. Provision a **test-only** Stripe endpoint and its signing secret in Secrets Manager, and an independent `sk_test_` secret. Never place secrets in GitHub, logs or `VITE_*` environment variables. Review Lambda network/CloudWatch permissions separately.
4. Run source tests for authentication-first Stripe Session retrieval, exact carrier-address HMAC, shipping/tax total matching, strongly consistent event read, conditional receipt write and duplicate-race recovery.
5. Explicitly decide the Lambda's operational failure behavior, durable replay worker and event-state transitions. This policy **cannot** authorize stock capture, order paid state, shipping labels or live charges.

The owner has deferred an AWS budget until credits are used. AWS promotional credits still do not constitute a hard spend cap; keep all additional infrastructure behind review.

**This is preparation only.** The current two TEST ledgers stay empty and active, original inventory remains untouched, and Stripe payments stay OFF.
