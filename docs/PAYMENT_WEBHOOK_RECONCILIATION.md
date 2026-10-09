# Payment webhook replay and reservation reconciliation — offline safety model

**Not a Stripe webhook handler. No live/test payment requests, Amazon DynamoDB mutations, labels or customer checkout are activated by this code.**

The new `backend/payment-webhook-review.mjs` is a *pure decision gate* for future verified Stripe test-mode events. It is deliberately **not wired to any endpoint**. Its approval flag for mutations is always `false`. It exists so we can exercise difficult cases without creating financial or inventory events.

## Enforced event prerequisites

- Raw HTTP request body must be verified with the official Stripe SDK `stripe.webhooks.constructEvent` and the correct webhook signing secret **outside** this pure helper. A `signatureVerified:true` boolean supplied by a client is NEVER valid proof.
- Only recognized `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed` events in TEST mode may be reviewed.
- Verify immutable orderId and server-stored test sessionId; never trust customer-controlled redirects, fake status updates or amounts.
- Require approved U.S.-only shipping (no pickup), item snapshots, exact **integer-cent** USD order subtotal + approved carrier shipping + calculated tax = immutable final amount matching the provider event.
- Refuse fake or null totals and absent tax. These requirements deliberately block current drafts where totals remain unknown.
- Require the order to be in the expected reserved/pending/UNFULFILLED state with a valid version and hold expiry.
- Check the event ID against a future **durable** atomic event ledger and compare exact payload fingerprints. Replays with matching content are safe no-ops; reused IDs with changed amounts are errors.
- Paid-before-expiry: decision is *reconciliation required*, not automatic fulfillment. Late paid event: **manual late-payment/refund reconciliation required**, not blind stock capture.
- Expired or failed payments require controlled release review, never unconditional stock release; a late success might race with an expiry event.
- `checkout.session.completed` with unpaid status does not imply success.

## To implement before payment enablement

1. Dedicated secure Stripe webhook Lambda that verifies signatures from the **raw body**, separates test/live provider secrets, and validates complete event scope.
2. Atomic durable event-ID receipt table + per-order versioned state + order-request idempotency. Avoid duplicate capture/refund/release on retries or multiple event types.
3. Transactional reserved-stock capture (decrement `onHand` **and** `reserved`) on verified payment with sufficient available stock, or safe release when payment truly fails/expires; crash/retry/late-success policies.
4. Verified live carrier shipping quote, persisted with expiry/cart/destination digest and supported carrier account, plus verified tax and server-authoritative final amount.
5. Stage/test end-to-end from browser to order to signed webhook to stock ledger and fulfillment, including out-of-order and duplicated webhooks.
6. Grant scoped, reviewed AWS IAM and keep legacy source inventory reconciled with the future Stock V2 migration.
7. Obtain merchant approval for refund/return windows, late payments and failed delivery outcomes.

**Current status:** no deployed Checkout V2 backend or Stripe webhooks; live payments remain disabled and browser cart remains informational. No AWS resources added or changed in this PR.
