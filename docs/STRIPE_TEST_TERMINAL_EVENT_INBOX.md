# Stripe TEST unpaid Checkout inbox: completed-awaiting-payment / expired / async payment failed

**SOURCE-ONLY, NOT DEPLOYED. No DynamoDB item was written, no Stripe API charge, no order was canceled, no stock was released.**

The previously merged signed webhook inbox handles a **paid/completed** Checkout Session against a tax-finalized Order V2 snapshot. However, a `checkout.session.completed` event with `payment_status:'unpaid'`, a signed expiry, or an asynchronous-failure event can arrive while an Order V2 still has `taxCents:null` and `totalCents:null`; they must not be discarded merely because final tax was never calculated. They also must **not** automatically authorize inventory release, since an asynchronous payment may still settle and out-of-order events are possible.

`backend/stripe-test-terminal-event-inbox.mjs` now offers the strictly independent `recordSignedStripeTestUnpaidEventForReview(...)` source-only adapter; the old `recordSignedStripeTestTerminalEventForReview(...)` export remains a compatible alias for existing tests:

- Verifies raw `Stripe-Signature` via official SDK interface *before any provider lookup or DynamoDB request* and independently fetches the exact signed `cs_test_` Checkout Session on the server.
- Accepts signed `checkout.session.completed` only when the independently retrieved Session is **complete/unpaid**, `checkout.session.expired` only when the provider Session is **expired/unpaid**, or `checkout.session.async_payment_failed` only when the provider Session is **complete or expired/unpaid**; matches provider amount and immutable server-owned test-mode order IDs. Rejects paid events, altered signatures, live-mode Sessions, other Session IDs and already-paid or unbound orders.
- Permits explicitly **null/unset tax and total**, but if an order already has a finalized total it must match the provider amount. A non-finalized expired payment must never be interpreted as zero tax.
- Uses an injected, future least-privilege strongly consistent `GetItem` and atomic `PutItem ConditionExpression:'attribute_not_exists(eventId)'` on **only** the existing isolated TEST event ledger table (the same deployed table, but no real adapter is attached yet).
- Writes a compact, PII-free `PENDING_REVIEW` receipt with provider/signed fingerprint/immutable order & session IDs. `checkout.session.completed` + `unpaid` is `WAIT_FOR_VERIFIED_PAYMENT` / `AWAIT_PROVIDER_PAYMENT` and **does not require immediate manual review**, whereas expiry and async failure use `REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS` and require human review.
- All return paths, including exact duplicates, return `requiresDurablePaymentCheck:true`, `stockReleaseAuthorized:false`, `paymentWriteAuthorized:false`, `stockWriteAuthorized:false`, `fulfillmentAuthorized:false` and `checkoutEnabled:false`. `holdStillActive` is informational only and does not grant permission to release anything.

The new adapter **deliberately never invokes** `buildExpiredReservationReleasePlan` or the stock settlement routines. Automatic expiry/cancellation still requires a separate source of durable final-payment proof, concurrency handling across paid/expired/out-of-order events, operator-approved reversal/refund behavior, and one atomic Order V2/Stock V2/event ledger terminal transition. A Stripe `payment_status='unpaid'` alone does NOT prove a charge can never occur.

Unit tests `tests/stripe-test-terminal-event-inbox.test.mjs` cover no-final-tax completion awaiting payment, expiry, async failure, before/after hold expiry, signed event corruption, provider mismatches, duplicate races, wrong table, already paid orders and no PII/stock mutation.

**Staging requirements still missing:** Orders/Stock V2 AWS sandbox and CloudFormation execution role, future test-only webhook Lambda/API and server-side Secrets Manager signing key, authorized restricted DynamoDB client, and full staging tests. Current GitHub OIDC role cannot deploy this; the connected AWS Core identity must never be used as root for IAM or billable infrastructure changes.

**Cost gate:** Owner requested an explicit estimate and authorization **before execution of any potentially chargeable action**. Creating a source file or CI test does not authorize billable AWS resources, paid carrier APIs, shipping labels or live Stripe payments.
