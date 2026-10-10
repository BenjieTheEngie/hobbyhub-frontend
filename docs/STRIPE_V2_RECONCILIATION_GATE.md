# Stripe V2 — one mandatory source-only payment reconciliation gate

**Non-executable staging architecture. Nothing here creates Stripe sessions, registers webhooks, updates DynamoDB, charges customers or ships products.**

Previous Hobby Hub safety helpers existed separately. That creates an operational risk: an eventual Lambda developer might verify a signature but forget to check carrier address, sales tax or durable webhook replay records. `backend/stripe-v2-reconciliation.mjs` composes the existing checks in **one mandatory fail-closed source-only interface**:

`reviewStripeTestCheckoutReconciliation({request,stripeSdk,webhookSigningSecret,retrievedSession,order,checkedAt,destinationSigningKey,previousEvents})`

### Required server-owned inputs

- Exact API Gateway POST raw request + `Stripe-Signature`, verified with the official Stripe SDK and test-only webhook signing secret in Secrets Manager.
- An independently retrieved Stripe TEST Checkout Session using a **trusted server-side Stripe key**, not customer JSON or browser return parameters.
- A strongly consistent server-owned Checkout V2 order with immutable productId/price snapshots and versioned stock reservation; separate Stock V2 table not yet deployed.
- A **private 32+ byte HMAC** key and order-carried fingerprint of the actual carrier-rated street/city/ZIP destination, plus quote expiry and tax totals.
- A **persisted** Stripe event ID/fingerprint replay history from the retained test ledger; JavaScript Maps are unit-test representations only, not a viable production replay store.

### Mandatory checks

1. Verify Stripe's signed original body and supported TEST-mode Checkout Session event.
2. Compare signed event sessionId, orderId, exact currency/amount/payment status with the **SDK-retrieved** session; reject all disagreement.
3. Verify the server order and exact item subtotal, shipping, Stripe Tax, discounts (zero) and final cents, complete full-address HMAC and unexpired carrier quote. The U.S. state must be 50 states + DC.
4. Check previously persisted Stripe event fingerprint for replay/collision and run the existing signed-payment reconciliation plan (including late payment/failed/expired safeguards).
5. Output an **inert** classification and flags set to `false` for `executable`, `paymentWriteAuthorized`, `stockWriteAuthorized`, `fulfillmentAuthorized`, `paymentCollectionEnabled`. `pendingAtomicSettlement:true` is only a **planning classification**, NEVER authorization to write.

### Still blocking launch

The function deliberately has no HTTP handler, Stripe API call, Secrets Manager lookup or DynamoDB transaction executor. Actual test webhook registration and idempotent durable database writes are impossible until owner-approved, isolated, least-privilege AWS staging infrastructure exists and is thoroughly tested. Stripe could still collect a test payment before the event is reviewed; do not send a test Checkout session to a real shopper.

See `docs/STRIPE_V2_LEDGER_FOUNDATION.md`, `docs/STRIPE_CARRIER_DESTINATION_BINDING.md`, `docs/STRIPE_V2_SANDBOX_BOUNDARY.md`, and `docs/STRIPE_STAGE_DEPLOY_AND_TEST_PLAN.md`.
