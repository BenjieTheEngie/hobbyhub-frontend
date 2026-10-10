# Stripe V2 sandbox ledgers — actual deployed state (October 10, 2026 UTC)

**Confirmed through read-only AWS API calls after the owner explicitly approved and executed the reviewed CloudFormation change set.** Scope: AWS account `349744180170`, region `us-east-2`. No AWS root credential or ChatGPT tool was used to create the stack.

## Deployment verification

- Stack: `hobbyhub-stripe-sandbox-ledgers` — **CREATE_COMPLETE**.
- Execution role: `arn:aws:iam::349744180170:role/HobbyHubStagingLedgerCfnExec`.
- The owner executed the previously reviewed `hobbyhub-review-38016180343-1` change set (GitHub preview workflow [run 38016180343](https://github.com/BenjieTheEngie/hobbyhub-frontend/actions/runs/38016180343)). This change set proposed **only two AWS::DynamoDB::Table additions**, with parameters `Stage=sandbox` and `EnableStripeCheckout=false`.
- After execution, the ephemeral change set name no longer resolved in `DescribeChangeSet`; **use the completed CloudFormation stack and its exact two stack resources as the authoritative deployed state**, not the old unexecuted preview link.

| Logical resource | Physical table name | Key |
| --- | --- | --- |
| `StripeTestCheckoutRequestLedger` | `hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S` | `requestId` (S) |
| `StripeTestEventLedger` | `hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5` | `eventId` (S) |

For **both** new tables, AWS `DescribeTable` and `DescribeContinuousBackups` reported:
- Table status **ACTIVE**, billing mode **PAY_PER_REQUEST**.
- DynamoDB server-side encryption **ENABLED** (AWS-owned/service-reported KMS key ARN).
- Continuous backups **ENABLED**, point-in-time recovery **ENABLED**.
- Both new tables empty: strongly consistent DynamoDB `Scan(Select=COUNT)` returned **0 records** in each.
- CFN resource status **CREATE_COMPLETE** for exactly these two tables; no Lambda, webhook, Orders, Stock V2 or production catalog resource was part of this stack.

## Source catalog preservation and non-activation

A separate, strongly consistent read-only scan after the deployment returned:
- Original Products `hobbyhub-ProductsTable-KC31XDEOENBG`: **7 records**.
- Original Inventory `hobbyhub-InventoryTable-X2IRQDAGW7WB`: **7 records**, combined `quantityOnHand=301` units.
- Both original tables still ACTIVE with PITR ENABLED and remain keyed by `productId`. These match the pre-deployment totals. **No data mutation was performed by this assistant**.
- Stripe payments remain disabled by the new stack: `EnableStripeCheckout=false`. There are **no Stripe receiving Lambda/API routes, payment event writers or automatic stock decrements** in this deployment.

These empty ledgers enable us to build durable webhook replay and checkout request idempotency in separate **future staging code**. They do **not** make real customer checkout possible, publish inventory, or reserve stock on their own.

## Required next steps before another AWS write

1. Create a merchant-approved **AWS Cost Budget** (recommended $25/month alert with notifications at $10 and $20 actual spending). Promotional credits are **not a billing cap**; there was no budget at the pre-deployment read.
2. Review tightly scoped *data-plane* roles for a future isolated test webhook and checkout writer. Existing `HobbyHubStagingLedgerCfnExec` permits table configuration only; `HobbyHubStagingDeploy` permits change-set previews only. No ledger item write permission has been granted.
3. Integrate server-side code for event ID conditional idempotency, request ID deduplication, signed raw-body Stripe webhook validation, order-version checks, payment/tax/carrier quote verification and state-machine tests.
4. Isolate Stock V2 and Orders V2 staging infrastructure, and define a safely verified data migration that never assumes product SKU is the stock table key. Await owner decision and review before billable writes or stock migration.
5. **Do not rerun** `Preview Stripe sandbox ledgers in AWS (NO DEPLOY)` against an already created stack: it intentionally refuses to edit existing resources.
6. Keep live Stripe payments OFF until merchant approval and successful staged tests. Do not enable the legacy SKU-keyed checkout under any circumstances.

Source: `aws/stripe-v2-ledgers/template.yaml`, `docs/STRIPE_STAGE_DEPLOY_AND_TEST_PLAN.md`, `docs/STAGING_LEDGER_IAM_REVIEW.md`.
