# Hobby Hub — test-mode Stripe webhook state-planning foundation

**Source-only, offline, not a Stripe webhook handler, and not deployed to AWS.** This is intentionally inert transaction data so we can review safe order state rules before enabling real payments.

## What is covered

- `backend/checkout-webhook-plan.mjs` validates a test-mode Stripe checkout event against a previously persisted server-owned `orderId`, exact `cs_test_` session ID, USD integer-cent final charge, shipping-only U.S. order, expected unfulfilled/pending state and a confirmed reservation expiry.
- No payment can be inferred from a browser success URL. `checkout.session.completed` with `payment_status: unpaid` stays pending.
- Test paid events propose a *non-executable* DynamoDB transaction: update an exact versioned order to PAID and record a unique Stripe eventId simultaneously. Duplicate event IDs and changed order versions would be blocked by conditions *if a future verified backend executed it*.
- Expired sessions and late payments **DO NOT automatically free stock or approve fulfillment**: there must be a separate reconciled release/refund workflow first.
- Payments marked completed without a verified total, incorrect session/metadata, or non-U.S./pickup orders fail closed.
- No test-mode event causes payment, inventory, external API, or order table writes. No Stripe secret or full shipping address enters the transaction.
- New unit tests cover all of these cases.

## Major launch work NOT implemented

1. Real Stripe raw-body signature validation using the correct endpoint secret, webhook type allowlist and replay/event uniqueness. A caller-provided boolean does not authenticate a Stripe event. **No webhook API handler exists.**
2. Consistent server-owned quote/stock reservation lifecycle, including expiration, capture, refund/release and safe handling of payments that arrive after stock is returned. The present Stock V2 tables are not deployed or migrated.
3. Merchant-confirmed U.S. carrier-calculated shipping prices, authenticated packaging profile, tax calculation and **final total**. Current preview quote explicitly has `totalCents:null` so **cannot pass** this planner's payment validation.
4. A separate webhook-events audit table with PITR and Retain protections and least-privilege permissions, plus verified test sessions in staging.
5. Complete positive/negative test mode scenarios: async payments, payment disputes, timeouts, duplicate/reordered events, expired carts, concurrent orders, late success, and full/partial refunds.
6. Owner-approved legal, returns, shipping, tax, privacy and business policies.

Do not deploy `backend/checkout-webhook-plan.mjs` as a handler or treat its `proposeTestPaidTransaction` return as an executable production operation. Any payment-enable action requires explicit owner confirmation after sandbox verification. No customer card data should ever be stored or logged by Hobby Hub.
