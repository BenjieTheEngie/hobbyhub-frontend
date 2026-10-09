# Hobby Hub — reservation settlement design (NOT deployed)

The payment and stock reservation lifecycle consists of three distinct authorities:

1. **Verified Stock V2** holds physical `onHand` and temporarily `reserved` units keyed by immutable `productId`; all atomic writes are version-guarded. The original legacy Inventory table is not modified by the new plan.
2. **Customer Order V2** stores finalized checkout totals, an associated Stripe session, item snapshots, and an explicit lifecycle state.
3. **Signed Stripe webhook** is the sole authority for paid, expired, canceled and failed payment state. Neither browser return URLs nor frontend status flags can authorize fulfillment or release.

## Implemented offline

`backend/stock-reservation-settlement.mjs` exports the pure `planVerifiedReservationSettlement` function. For a `RESERVED / PENDING` order and independently verified current stock snapshots, it produces:

- **Capture** when a paid Stripe event matches the saved session, currency USD, exact finalized total and tax: decrement *both* `onHand` and `reserved` per line, mark the order PAID, write an idempotent audit event. Available-to-sell stays unchanged because the reserved units are now physically consumed.
- **Release** only after a verified Stripe terminal expiration/failure/cancellation: decrement `reserved` while leaving `onHand` unchanged, mark the order RELEASED / CANCELLED, write an idempotent audit event. Available-to-sell increases.
- All updates use a single proposed DynamoDB transaction: stock updates with exact `version/onHand/reserved` expectations; order update conditioned on `RESERVED/PENDING` state, order version and payment session; audit insert conditioned on a never-reused Stripe event ID.

**These are plans only.** There is no API route, Stripe secret, AWS transaction invocation, background release worker, or executable method. `executable:false` is included deliberately. A caller-provided `serverSignatureVerified:true` boolean is **not proof** of authenticity and must NEVER be accepted from a user/browser; only the deployed raw-body Stripe signature-verifying webhook may construct trusted provider evidence internally.

## Required before deployment

- Set up merchant Stripe account in **test mode**, signed webhook endpoint using the raw request body, strict event type/session ownership and amount verification. Do not enable Stripe live keys.
- Implement an independently authorized final-tax/production-carrier-rate checkout quote with immutable server-stored idempotency key, session ID and expiry. The current prior checkout plan stores `totalCents:null`, so there is **no payment-ready order** to capture.
- Build a guaranteed reconciliation process for webhook retries, delayed events, expired holds, late-paid sessions, refund/dispute events and out-of-order delivery. DynamoDB atomic cancellation avoids double settlement, but a webhook event log is still needed to reconcile provider state.
- Add an explicit separate per-order reservation request ID uniqueness table and secure Stripe session association. Do not let a customer supply an order ID, payment status, final charge, item price, or shipment proof.
- Perform in-account staging transaction integration tests for stock conflicts, transaction cancellations, duplicate webhooks and retention cleanup, using disposable test products and test sessions.
- Verify Cognito administrator authorization, least-privilege IAM service roles, log redaction, PITR, and independent recovery backups.

No new resources or payments are enabled by this design. The original 7 Products and 7 Inventory rows/301 units remain untouched.
