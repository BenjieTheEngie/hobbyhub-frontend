# Stripe Checkout V2 — source-only sandbox session financial reconciliation

**Not a live payment integration, no Stripe API calls, no AWS writes.** Built after signed sandbox webhook review in PR #55. The connected Hobby Hub **Stripe sandbox** reported **zero Checkout Sessions and zero webhook endpoints** on October 9, 2026. No live processor session or webhook endpoint has been created.

`backend/stripe-test-session-total-audit.mjs` exports `auditStripeSandboxSessionTotals({session,order,checkedAt,destinationSigningKey})`. Trusted backend code must use the official Stripe SDK to retrieve the **test** Checkout Session and strongly consistent server-side order from dedicated, later-deployed Stock V2/Order V2 tables. The browser may not supply the session/order snapshot. This helper only compares them and returns an **inert decision**; it never marks payment or stock paid/released and never ships an order.

## Reconciliation checks

- Requires exact `cs_test_` session identity in both stored server order and retrieved provider object; `client_reference_id` and session `metadata.orderId` must equal the immutable `orderId`, with USD, payment mode and `livemode:false`.
- Enforces order still has a versioned `RESERVED / PENDING / UNFULFILLED` state, complete immutable item snapshots, correct U.S.-only shipping policy with no pickup, and an independently reviewed shipping address.
- Requires a supported U.S. state and ZIP (no territories or military mail), the same recorded shipping state, **and** an exact HMAC-SHA256 proof of the carrier-rated street, city, unit, state and ZIP using a secret 32+ byte server-only key. It now rejects all changed delivery addresses, missing HMAC proofs and expired carrier quotes. See `docs/STRIPE_CARRIER_DESTINATION_BINDING.md`. Actual deliverability, carrier quote identity and preventing Stripe from collecting at a changed destination remain separate launch gates.
- Reconciles each cent of Stripe `amount_subtotal`, `shipping_cost.amount_total`, `total_details.amount_tax`, `total_details.amount_discount` (zero for now), `amount_total`, and each server-stored product unit price/quantity. Expects Stripe Tax enabled and completed. This deliberately rejects prepaid Checkout sessions when tax is unknown or dynamic amounts differ.
- For `complete / paid`, requires valid payment intent, and distinguishes payment before/after reservation expiry. Unpaid/expired sessions cannot approve fulfillment or automatic stock release.
- Returns **`paymentWriteAuthorized:false`, `stockWriteAuthorized:false`, `fulfillmentAuthorized:false`, `checkoutEnabled:false` always**, including fully matching paid test snapshots.
- Omits Stripe customer/shipping address/payment PII from output. Does not trust redirect pages, customer emails or manual payment claims.

### Before creating test Checkout Sessions

Future secure server needs a **durably reserved Stock V2** and immutable signed order first, complete verified carrier-calculated quote bound to actual shipping destination (including address digest, not just state), Stripe Tax result and correct Stripe checkout price/tax configuration, idempotent session creation/persistence, a verified signed webhook and durable event ledger, safe late payment/expiry/chargeback handling, and an approved least-privilege AWS identity. These are not connected yet, so **do not create a Checkout Session from this module**.

See `docs/STRIPE_V2_SANDBOX_BOUNDARY.md`, `docs/CHECKOUT_V2_RESERVATIONS.md`, `docs/OCTOBER_16_PILOT_GATES.md`.
