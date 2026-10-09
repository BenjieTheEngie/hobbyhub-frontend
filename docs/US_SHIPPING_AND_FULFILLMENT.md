# Hobby Hub U.S. shipping and fulfillment launch rules

**Owner decision: U.S. shipping only; no local pickup.**

Status: **offline source and tests. Not a live shipping or payment service.** The storefront remains a browsing/cart experience without checkout.

## Implemented in this phase

- `backend/shipping-v2.mjs`: validates domestic address formatting (recipient, street, city, U.S. state, ZIP, country), rejects international shipping and pickup settings, and accepts the 50 states plus Washington, DC. U.S. territories and military APO/FPO destinations are excluded **for now**, pending explicit business and carrier decisions.
- `shippingRegion`: lower 48 + DC, Alaska, Hawaii. Price rules **must** explicitly cover all three regions. No silent "free shipping" or assumed carrier charges. Flat-rate schedules in tests are **fixtures only**, not public rates.
- `validateShippingRates`: requires an operator-approved, U.S.-only no-pickup configuration, integer-cent prices, and defined rates for every region. Missing prices block a shipping estimate.
- `quoteDomesticShipping`: returns a safe price estimate with limited destination metadata but **does not claim carrier address validation, service selection, or delivery dates**.
- `composePrecheckoutTotals`: provides an informational subtotal plus approved shipping estimate. Tax and the final charge remain null; checkoutReady remains false.
- `backend/checkout-v2-core.mjs`: draft stock-reservation transactions now refuse an unconfigured domestic shipping quote and store `shippingMethod='domestic_shipping'`, `shippingCountry='US'`, an estimated rate, and **null final total**. This is a pure transaction plan and must not be executed in production.
- `backend/fulfillment-v2.mjs`: pure guarded order transition plans (UNFULFILLED → PICKING → PACKED → SHIPPED → DELIVERED), with strict paid-state and address verification checks, shipping-label confirmation, carrier+tracking requirements, version checks, and separate atomic audit events. This does **not** buy shipping labels or update DynamoDB.
- Order dashboard and cart explain that no international shipping, local pickup, taxes, shipping charges or checkout are live.

## Safety and privacy

1. Country must be `US`; allowed state codes are the 50 states and DC. `PR`, `GU`, `VI`, `MP`, `AS`, `AA`, `AE`, and `AP` are not enabled in phase one.
2. Field formatting does **not** prove that a street address is deliverable. Carrier/provider address verification must happen server-side before fulfillment.
3. Rate selection must use a merchant-approved policy or verified live carrier quote on the server. The buyer must see exact shipping and applicable taxes before authorizing payment.
4. Stripe live mode remains off. No payments, stock reservations, fulfillment events, labels, refunds or tracking updates can be performed by these modules alone.
5. Paid status is supplied by a *future* signed, idempotent Stripe webhook, never a user-controlled request or browser redirect.
6. Fulfillment audit records do not contain street addresses, customer emails or payment credentials. Shipment tracking is only displayed to authorized fulfillment users in a future privacy-scoped API.
7. Existing Products and Inventory records are untouched; checkout still requires reconciled Stock V2 `reserved` balances and atomic order idempotency before connecting to AWS.
8. Cancel/refund flows are explicitly not enabled. A paid order cannot be cancelled simply by changing its UI status; refund and stock release need separate verified workflow.

## Operator decisions before live checkout

The following are still **unconfigured** and require merchant approval:

- Shipping charge model: approved flat-rate by region, or calculated carrier rates. No test fixture values should be used commercially.
- Carrier and services (USPS/UPS/FedEx), packaging/weight for cards versus sealed boxes versus video games, and shipping insurance/tracking thresholds.
- Shipping origin, handling time, and any free-shipping threshold.
- Returns/cancellations policy for singles, sealed items and used video games.
- Whether U.S. territories and military mail will ever be supported (not enabled in initial version).
- Final sales-tax setup and signed Stripe webhook processing.

## Local tests

```bash
node --test tests/shipping-v2.test.mjs tests/fulfillment-v2.test.mjs tests/checkout-v2-core.test.mjs tests/order-workbench.test.mjs
npm run build
```

The entire repository's `tests/*.test.mjs` suite also runs in GitHub Actions. This work adds no new AWS infrastructure and changes no Vercel environment variables. Shipping/fulfillment plans are not web endpoints.
