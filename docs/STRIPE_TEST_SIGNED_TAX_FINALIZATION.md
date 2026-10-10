# Stripe TEST signed paid event — tax and total finalization plan

**Source only. NOT an AWS Lambda route, NOT a payment capture and NOT a deployed database update. This code performs no AWS calls, no actual carrier requests, no Stripe charges, and no inventory changes.**

The Checkout V2 lifecycle now has proposed no-write models for:
1. Merchant-approved `productId` stock and shipping quote → conditional reserved order + request ledger
2. Versioned `RESERVED/PENDING` Order V2 → binding to exactly one **open/unpaid** Stripe test Checkout Session (PR #80)
3. **This PR:** After a signed **paid** Stripe test event, independently retrieve the exact Session and reconcile final Stripe Tax and payable total; plan a conditional Order V2 update that persists only finalized integer `taxCents` and `totalCents`, incrementing order version
4. Existing signed event inbox (PENDING_REVIEW) and existing **atomic** Stock/Order/EventLedger `PAID/SETTLED` transition remain separate, future steps—**no one step authorizes fulfillment**

## Source contract

`backend/stripe-test-signed-tax-finalization-plan.mjs` exports `planFinalizeSignedStripeTestOrderTotals({request,stripeSdk,webhookSigningSecret,order,checkedAt,destinationSigningKey,orderTable})`.

The source verifies the raw Stripe-Signature through the trusted official SDK, then independently retrieves the exact signed `cs_test_` session from a trusted server-held `sk_test_` client. Both provider sources must agree on event, session, order ID, test mode and paid total. A forged browser Checkout Session or customer success redirect is never sufficient.

It reuses `reviewStripeTestCheckoutReconciliation` after proposing `taxCents` and `totalCents` from Stripe's completed automatic-tax calculation. That existing audit validates full carrier-approved address HMAC (including street/city/ZIP), U.S. state, approved shipping charge, zero discount, item quantities/prices, positive verified PaymentIntent, valid carrier quote, unexpired reserved stock hold, payment status and immutable order identity.

The emitted `UpdateItem` for the exact isolated Orders V2 sandbox table is conditioned on:
- Expected optimistic order version and unchanged `RESERVED/PENDING/UNFULFILLED` statuses.
- Exactly the previously linked Stripe TEST session IDs and payment mode.
- Both `taxCents` and `totalCents` originally persisted as DynamoDB NULL values; a second attempt cannot overwrite them.
- No prior `paymentEventId`, unchanged subtotal, shipping charge, reserved-until timestamp, carrier quote expiry, shipping state and address HMAC.

The plan retains `status:'RESERVED'`, `paymentStatus:'PENDING'`, `executable:false`, `checkoutEnabled:false`, and all stock/payment/fulfillment write authorization flags **false**. It cannot mark stock sold or authorize shipping.

**Crash/retry note:** If a future backend applies the conditional tax update and crashes, the next webhook retry must strongly consistently read the order first. If tax/total are now present, it must **independently verify that those values still match Stripe** and continue to event inbox/atomic settlement rather than blindly run the one-time tax plan again. That orchestrator does not yet exist; do not deploy partial flows.

**Amounts/costs:** Test-only code and local fake SDK fixtures. No AWS role/permissions, production products/stock, payment settings, carrier label, or external service was changed. The user specifically requires asking **before every potentially chargeable action**, even when AWS promotional credits exist.

Offline test: `node --test tests/stripe-test-signed-tax-finalization-plan.test.mjs`. Live payment enabling remains explicitly blocked pending independent staging review, actual carrier quotes, order authorization, credentials storage, complete end-to-end tests and explicit owner approval.
