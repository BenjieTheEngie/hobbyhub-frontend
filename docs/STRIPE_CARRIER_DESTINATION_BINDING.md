# Stripe Checkout V2 — bind a carrier quote to the exact delivery address

**Offline source-only change. No live or test Stripe sessions, carrier labels, AWS writes, API endpoints or customer payment.**

### Risk addressed

A U.S.-only Stripe Checkout Session can let a buyer change their street, city or ZIP code after Hobby Hub requests a carrier-calculated rate for the original address. Matching only state, payment amount and tax is **not proof** that postage is still correctly priced. A changed same-state address must not silently authorize an order, even if the charge total matches.

### New guard

`backend/stripe-shipping-bind.mjs` contains a private-key, server-only HMAC-SHA256 binding. It canonicalizes the carrier-rated address and the address returned by a server-side Stripe SDK-retrieved Checkout Session, including country, state, full ZIP/ZIP+4, city, line 1 and line 2. It rejects territories, APO/FPO, unsupported countries and missing/incomplete addresses. The recipient's name is excluded from the rate-location digest; the actual address still needs deliverability verification before shipping.

A future secure backend must:

1. Generate a **cryptographically random 32+ byte HMAC signing key** and store it in AWS Secrets Manager in the **test-only** staging namespace. Never expose it in Vite client variables, frontend JavaScript, GitHub Actions, order logs, messages or unit-test fixtures. The committed test key is explicitly NOT a production secret.
2. Obtain the address from a trusted cart/address validation flow and use the exact validated address for live carrier quoting. Use `shippingDestinationHmac(approvedAddress,key)` to store ONLY `shippingDestinationDigest` on the server-owned order snapshot, along with the correct state, carrier quote/provider identity and immutable quote expiry. Do not retain or expose raw addresses on public order exports.
3. Retrieve the Stripe Checkout Session through the **server-owned SDK**, never by client-authored metadata/redirects. `auditStripeSandboxSessionTotals({session,order,checkedAt,destinationSigningKey:key})` checks the full provider address against the approved order HMAC, exact USD cart/shipping/tax/total, Stripe Tax completion, server order state and expiry.
4. A changed street/city/ZIP/unit, missing signing key/digest or expired carrier quote **fails closed**. The paid-order event requires support/manual reconciliation/refund review; it does NOT capture stock, allow fulfillment or automatically refund.
5. Test all address shape conversions, Stripe's `collected_information.shipping_details.address` and legacy `shipping_details.address` variants, exact quote invalidation, failed/async payments, multi-parcel rating and merchant labels.

**Important:** The helper prevents unauthorized acceptance of changed addresses but does **not** prevent Stripe from charging a customer before webhook reconciliation. To avoid late charge-and-refund surprises, checkout session creation must bind the address upstream and/or use an approved way to update shipping options for the final destination; this remains an architectural blocker before paid launch.

There is **still no deployed server-side session creation, tax/rate service, webhook route, stock settlement, production payments or AWS Stock V2 migration.** See `docs/STRIPE_TEST_SESSION_TOTAL_RECONCILIATION.md` and `docs/STRIPE_STAGE_DEPLOY_AND_TEST_PLAN.md`.
