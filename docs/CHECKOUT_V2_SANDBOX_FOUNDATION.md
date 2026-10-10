# Checkout V2 — isolated Orders and Stock sandbox foundation

**Source-only preparation. As of this change, this stack has NOT been deployed, and neither new table exists in AWS. No billable AWS action was executed by this PR.**

This is intentionally independent of:
- The original production `hobbyhub` stack, its productId-keyed Products and Inventory tables and historically verified 7 products / 7 inventory rows / 301 physically recorded units.
- The **already-deployed**, separately retained `hobbyhub-stripe-sandbox-ledgers` stack, containing the empty `eventId` and `requestId` TEST ledgers.
- Any user-facing storefront, inventory migration, Stripe webhook endpoint, Stripe Checkout Session creation, shipping label or live/test payment collector.

The proposed `aws/checkout-v2-sandbox-foundation/template.yaml` defines **exactly two new empty** CloudFormation-managed DynamoDB tables:

| Logical ID | Partition key | Proposed use |
| --- | --- | --- |
| `StockV2` | `productId` (string) | Future strictly isolated Stock V2 balance and reservation state |
| `OrdersV2` | `orderId` (string) | Future immutable server-owned order and payment state |

Each table is PAY_PER_REQUEST, encrypted at rest, PITR-enabled, and has `DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain`. CloudFormation generates a new physical table name. No TTL, streams, users, Lambda functions, permissions, API Gateway, secrets or scheduled actions are provisioned. The CloudFormation parameters `EnableCheckout` and `EnableStockMigration` are both **immutable `'false'`**; stage is only `sandbox`.

## Operational and security gates

1. **No costs without explicit owner approval before execution.** The owner authorized continued development but requests approval **before every action that can incur charges**. The user's AWS promotional credits are not a guarantee of zero charges. Before running any resource-creation or change-set-execution action, disclose exactly what will be created and explain estimated costs, applicable recovery/retention and possible ongoing charges, then obtain authorization.
2. Build a **new**, tightly scoped CloudFormation preview role and execution role pair for a proposed stack name such as `hobbyhub-checkout-v2-sandbox-foundation`, without broad wildcard DynamoDB data permissions or access to the original Products/Inventory or existing Stripe ledgers. Never add the stack to the existing `HobbyHubStagingLedgerCfnExec` role just to reuse permissions.
3. Perform an offline template audit, GitHub CI and real read-only IAM policy simulations. A future create-change-set preview must propose exactly these two table additions and no operations on the original `hobbyhub` stack.
4. After independent review and separate explicit approval for AWS spending, stage the isolated empty tables. **Do not populate Stock V2 with production quantities or publish products.** A separate owner-approved, physical-SKU/productId verified stock migration and reconciliation is required. Treat absent Stock V2 rows as **unavailable**, not zero or sellable.
5. Any proposed test webhook Lambda and data-plane permissions need their own security approval. In particular, `PENDING_REVIEW` in the deployed event ledger is **not** payment settlement; there must be atomic and idempotent Order V2+Stock V2 reconciliation, negative-order testing and secure server-only Stripe keys before any real payment activation.

## Verify before continuing in a future session

- Inspect main GitHub HEAD and CI before executing scripts. Do not assume this template is deployed just because it is committed.
- Query CloudFormation and `ListTables` in `us-east-2` to discover whether the new stack or any table exists before preparing another change set.
- Verify the original Products/Inventory table identities and PITR state remain unchanged; **do not issue stock write or migration calls**.
- Cross-check the test-ledger stack still exists and that Stripe Checkout remains disabled.
- Run the offline regression test `node --test tests/checkout-v2-sandbox-foundation-template.test.mjs` and SAM/CloudFormation lint CI.

Existing related modules are pure planning code: `backend/checkout-reservations-v2.mjs`, `backend/checkout-v2-core.mjs`, `backend/stock-reservation-settlement.mjs`, `backend/stripe-test-event-inbox.mjs`. Nothing in this stack makes their plans executable.
