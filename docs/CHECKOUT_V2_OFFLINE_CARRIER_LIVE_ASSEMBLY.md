# Pure live-carrier quote assembly — still NO payment/API execution

**SOURCE-ONLY, INERT. NOT A MERCHANT PAYMENT OR SHIPPING LABEL INTEGRATION.**

The file `backend/carrier-live-commitment-offline.mjs` provides `composeOfflineLiveCarrierCommitment({...})`, a standalone pure constructor that bridges verified product/parcel snapshots and the Checkout V2 reservation/idempotency planners. This was added because the existing `backend/carrier-checkout-preview.mjs` is explicitly an EasyPost **test-only** estimate and never becomes payment eligible.

Inputs must be built **inside a trusted server**:
- Product snapshots from `verifyCheckoutQuote` and measured, per-unit packed parcels from `parcelsForVerifiedCart`; both must match every productId and unit in the same deterministic order (1–8 parcels).
- Authenticated **live-mode** provider rates, one `rateId`, USD cents, carrier and service **per parcel**. This function can validate structure and exact totals, but cannot verify actual provider network authorization, shipping deliverability, merchant carrier account or rates on its own.
- An independently verified deliverability verdict, complete domestic destination address, and a **server-owned 32+ byte HMAC key**. The function persists only a keyed address digest, not the address or key.
- Server clock, reservation deadline, and carrier quote expiry strictly later than the hold. A stale or misaligned rate fails closed.

Output: server-only proposal with exact `carrierRateIds`, `carrierRateDetails`, `ratedParcelCount`, shipping amount and `shippingDestinationDigest`, preserving all fields required by `buildReservationTransactions` and `buildIdempotentReservationPlan`. It deliberately contains `checkoutReady:false`, `paymentReady:false`, `executable:false` and no tax/total. Thus it cannot create payments, reserve stock or purchase labels. Idempotency changes when the HMAC-bound street/address or allocation of individual carrier prices changes.

Tests `tests/carrier-live-commitment-offline.test.mjs` check matching measured units and provider rates, exact amounts, HMAC privacy, impossible time windows, changed-address replay collisions and malformed carrier data. They use fictional rates and a throwaway local HMAC key. **No live EasyPost API or Stripe request is made.**

## Remaining integration gates

1. A trustworthy server-only live carrier SDK adapter must independently authenticate every rate and quote expiry, and tie each rate to actual measured origin/destination/parcel dimensions. The test-only EasyPost adapter must **never** be substituted as live proof.
2. Confirm packing workflow, tax treatment, merchant-origin ZIP, actual real weights/dimensions, and customer address deliverability, with no unsupported territories/pickup. Zero approved production SKUs should be sold.
3. Checkout reservations and Stripe sessions require the isolated Orders V2/Stock V2 runtime and a separately reviewed, least-privilege non-root IAM execution path. These are not deployed yet.
4. Independently verify Stripe Tax and amount totals, webhook signatures, order versions, carrier address binding, and atomic stock/order/event settlement. Live payments stay disabled.
5. **Before anything that might incur charges**, including carrier API calls, live keys, AWS table deployments, or label buys, present costs and request explicit owner approval. Promotional AWS credits are not a hard charge cap.

This PR neither enables checkout nor adds any credentials, network calls or paid resources.
