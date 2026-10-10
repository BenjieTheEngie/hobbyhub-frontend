# Checkout V2 — Shipping commitment in reservation and idempotency (SOURCE ONLY)

**Offline code; not an AWS deployment, a Stripe payment, a carrier API request or authorization to collect charges.** PR introduces only validation and richer server-owned order/idempotency snapshots. The existing legacy flat-rate planning fixtures remain non-payment proposals and do not authorize real checkout.

## Why

A stock reservation's idempotency hash used to include country, region and shipping cents but **not the full ship-to destination or individual carrier rate selection**. Two different street addresses in the same state/ZIP could therefore share a checkout request ID and the same quote hash. That is not safe for a future real checkout.

## New requirements for carrier-confirmed quotes

Before the prepayment reservation planner will model a `carrierRateConfirmedForPayment:true` quote, it now requires:

- `rateMode:'live'` and a bounded `rateProvider` identifier. **This is input shape validation only, not independent proof of a genuine carrier response.** Future trusted server code must verify an actual carrier-calculated quote and eligibility.
- `shippingAddressVerified:true` after a separate address/deliverability check, and a full-destination `shippingDestinationDigest` in the exact `hmac-v1-<64 hex>` format. Compute the digest using `backend/stripe-shipping-bind.mjs` with a secret server-only HMAC key. Never persist the raw address in the order/idempotency ledger.
- Nonempty distinct, validated `carrierRateIds` for up to eight individual rated parcels. `ratedParcelCount` and the rate ID count must equal the **sum of ordered physical units** until a separately verified consolidated-packing model exists. `carrierRateDetails` must list the *same* rate IDs in order, with positive integer `shippingCents` per parcel summing **exactly** to the server-approved `shippingCents` total. This prevents one parcel's rate being silently reused to price several packages. No fabricated shipping rates; dimensions and packed weight must come from measured product packaging.
- A `carrierQuoteExpiresAt` UTC timestamp **strictly later than the reservation's `holdUntil`**. Shorter lived quotes cannot be used as payment-ready commitments.

The reservation snapshot retains the digest, original carrier identifiers, source and expiry for a subsequent **server-owned** Stripe session/address/tax comparison. The SHA-256 idempotency hash now includes the HMAC, selected rate IDs, per-parcel amounts and count, quote expiry and provider flags. Reusing the same checkout request ID for a changed address or rate is rejected as a conflict.

These structural checks do **not** independently attest that a shipping label is purchasable, carrier rate is accurate, tax is complete, stock was reserved, or an actual AWS write occurred. The planner remains non-executable; live payment endpoints remain off.

Historical fixed-region shipping estimator `quoteDomesticShipping` is only used in offline examples; an actual `rateMode:'live'` claim without a confirmed commitment fails closed. Old unconfirmed flat-rate plans remain `paymentReady:false` and `shippingAddressVerified:false`; never expose them to customers for charging.

Run offline tests: `node --test tests/checkout-v2-core.test.mjs tests/checkout-reservations-v2.test.mjs`. Before actual production deployment, integrate a verified carrier API response and HMAC generation using trusted backend code; then test with live real ZIP/parcel rates and merchant approval before paid API/label usage.

**User cost rule:** Ask the merchant before executing anything with potential charges, including AWS resources, carrier API usage, shipping labels or Stripe live payments. No such execution occurred in this change.
