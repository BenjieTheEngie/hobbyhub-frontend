# Stripe TEST webhook event inbox — source-only stage

**Date:** 2026-10-10 UTC. **Not deployed to Lambda or wired to API Gateway. No Stripe endpoint, Stripe session, order settlement or stock migration is activated by this code.**

The owner-approved AWS CloudFormation stack `hobbyhub-stripe-sandbox-ledgers` is already CREATE_COMPLETE in `us-east-2`. Both physical tables are ACTIVE, encrypted, PITR-enabled and empty. See `docs/STRIPE_LEDGER_DEPLOYMENT_VERIFICATION_20261010.md`.

## Concrete new source

`backend/stripe-test-event-inbox.mjs` exports:

`recordVerifiedStripeTestEventForReview({request,stripeSdk,webhookSigningSecret,retrievedSession,order,checkedAt,destinationSigningKey,ledgerClient,eventTable})`

This is an **offline-testable adapter, not an AWS Lambda handler**. Its `ledgerClient` must be a future trusted **AWS SDK DocumentClient wrapper** supporting `get(params)` and `put(params)`. It currently has no AWS SDK import and makes no call to AWS unless a future authorized caller injects such a client. The source pins table names to the physical `hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-` prefix, not to Products/Inventory or the separate request ledger.

- Authenticates exact raw HTTP request via the **official Stripe SDK** verifier and test-only signing secret. Signature verification happens **before any database operation**. Inputs must come from a trusted backend; user-controlled booleans, redirect URLs and webhook JSON are never proof of payment.
- Performs a **strongly consistent DynamoDB GetItem** to check existing `eventId` and build the persisted replay fingerprint map.
- Invokes `reviewStripeTestCheckoutReconciliation`, comparing the signed Stripe event with a separately **server-retrieved** test Checkout Session and immutable Order V2 snapshot. Requires exact item amount, Stripe Tax, carrier-calculated shipping, complete server-approved delivery address keyed HMAC, and unexpired carrier quote. It flags late payments for manual review.
- Constructs a compact PII-free event row: `eventId` (table partition key), `fingerprint`, `orderId`, `sessionId`, `schemaVersion:1`, `provider:'stripe'`, `mode:'test'`, `state:'PENDING_REVIEW'`, review dispositions and `recordedAt`. **No raw address, card, customer identity, Stripe secret or TTL** is saved.
- Performs **one atomic conditional PutItem** using `attribute_not_exists(eventId)`; a concurrent duplicate cannot overwrite the existing event. On a conditional conflict it performs a second strongly consistent GetItem and validates fingerprint/order/session/schema. Same-event retries return `alreadyRecorded:true` but **no settlement authorization**. A colliding event ID or corrupted row fails closed.
- Both new and replay receipts always return `paymentWriteAuthorized:false`, `stockWriteAuthorized:false`, `fulfillmentAuthorized:false`, `checkoutEnabled:false`, and `requiresDurableSettlement:true`.

`backend/stripe-v2-reconciliation.mjs` now exposes the **provider fingerprint from the existing signed-event review** to facilitate matching the durable ledger row; this is not customer PII.

## Important crash and retry model

This is an **inbox receipt only**, NOT a processed event log and NOT a reliable proof of payment settlement. A webhook can be recorded then crash before any settlement. Therefore the state must remain `PENDING_REVIEW`; neither receiving an event nor replaying it may decrement stock or authorize shipping.

Before any real checkout or even a routable test webhook, the next infrastructure phase needs:

1. A test-only AWS Lambda with least-privilege **GetItem/PutItem for this event ledger only**, with raw request-body signature verification and real Stripe SDK Session retrieval, plus separate strongly consistent *read-only* permission to an isolated Order V2 table. No permission to modify original Products or Inventory.
2. The Order V2 / Stock V2 isolated staging tables and a **single atomic** order + stock + event-state transition design that can survive races between paid, failed, expired and late events. A `PENDING_REVIEW` inbox row by itself must never suppress settlement.
3. Operational retry/recovery or monitoring of unprocessed inbox rows. This new adapter intentionally supports no Scan/Query or replay worker; those require separate IAM and testing.
4. A secure test-only Stripe webhook endpoint created in the connected Stripe sandbox and a per-endpoint secret stored server-side in Secrets Manager. Do not put secrets in frontend/Vite variables.
5. End-to-end tests using real Stripe test mode including repeated, out-of-order, expired, delayed, refunded, contested, and async events. All carrier/Stripe Tax and inventory consistency gates must pass before actual sales approval.

**Costs/permissions:** The two tables exist, but current CloudFormation role `HobbyHubStagingLedgerCfnExec` is control-plane only; the GitHub OIDC role is change-set preview-only. Neither has DynamoDB item read/write permissions. Do not grant root keys or wildcard DynamoDB permissions as a shortcut. AWS promotional credits are not a hard cost cap.

Run `node --test tests/stripe-test-event-inbox.test.mjs` locally. The existing AWS offline CI runs these tests. There is **no request to execute paid transactions**, and this module cannot deploy infrastructure.
