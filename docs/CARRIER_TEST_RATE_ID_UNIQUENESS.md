# Carrier TEST preview: independent parcel and rate identity

**Source-only safety change. No EasyPost request, Stripe API call, label purchase or AWS write performed by this PR.**

A carrier rate identifier refers to an individual shipment. The old offline aggregator could reuse the same cheapest `rateId` for multiple physical packages and report a plausible summed shipping price even though no two independent shipments were represented.

`backend/carrier-rating-v2.mjs` now fails closed when:
- The same selected `rateId` occurs on two different product units; one provider rate ID cannot purchase multiple labels.
- The same `productId` + physical unit is rated twice, or a parcel lacks a valid physical identity.
- An option lacks a verified TEST-mode EasyPost rate ID, supported carrier/service, exact USD currency, or positive integer cents.
- Aggregate shipping exceeds the merchant's existing $500 maximum checkout shipping bound.

`backend/carrier-checkout-preview.mjs` remains **TEST-only**, rate-only, non-chargeable and does not include provider rate IDs, addresses or customer PII in the buyer-facing preview. A failed second parcel rate makes the whole estimate unavailable; the system does not silently double the first rate.

`tests/carrier-checkout-preview.test.mjs` now models two different provider rate IDs for two distinct shipment requests; replaying the same ID across parcels is a negative test. `tests/carrier-rating-v2.test.mjs` covers duplicate parcel IDs, unsupported provider/rate metadata and invalid amounts.

This must not be confused with live carrier quote authentication, delivery verification, refunds or buyable labels. Those require actual trusted provider calls and explicit **owner cost approval before execution**. The test-only preview cannot enable Stripe or alter inventory.
