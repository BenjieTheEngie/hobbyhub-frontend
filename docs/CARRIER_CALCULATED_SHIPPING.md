# Hobby Hub — carrier-calculated shipping (test only)

**Owner decision:** U.S.-only shipping with **no pickup**, rated using measured package dimensions/weight and delivery destination. No fixed carrier prices or free-shipping threshold.

**Current status:** Source code + unit tests; **not deployed to AWS** and **not connected to the customer checkout**. Live Stripe payments, stock reservations and label buying remain disabled.

## Architecture

- `backend/carrier-rating-v2.mjs` validates a packed parcel's measured length, width, height (inches, one decimal) and fully packed weight (ounces, one decimal). Missing metadata fails closed. No default box or shipping rate is invented.
- `src/lib/packagingWorksheet.js` and the admin Inventory command center now provide a **local-only packaging worksheet**. Export one row per immutable `productId` (duplicate SKU records remain separate), then measure each sellable unit **already packed** (length, width, height in inches; weight in ounces). Unknown dimensions remain blank and the export does not write back to AWS. Before these measurements can drive live carrier checkout, upload through a future authenticated validated product-shipping-profile API.
- `parcelsForVerifiedCart` derives parcels from **server-owned product packaging profiles**, not dimensions entered by a shopper. Each line's unit becomes its own parcel until real consolidation/boxing logic is available. More than 8 parcels requires manual handling and does not silently estimate a combined package.
- `backend/easypost-test-rates.mjs` is an optional EasyPost TEST-mode adapter. It calls `POST https://api.easypost.com/v2/shipments` with the origin/destination and measured parcel. EasyPost returns rates from carrier accounts, without a label purchase. Only `EZTK...` test keys and test-mode responses are accepted. **There is no `/buy` call anywhere in the adapter.**
- `verifiedEasyPostRateOptions` accepts only USD rate strings with two decimal places, supported USPS/UPS/FedEx rates, provider test mode and valid rate IDs. A missing/invalid rate returns no quote; no inferred price or transit promise.
- `composeCarrierPrecheckout` combines the verified item subtotal and test carrier estimate but leaves tax, final amount and checkout-readiness unset. `buildReservationTransactions` explicitly rejects test carrier quotes: test prices cannot authorize stock reservations or payment.
- `backend/carrier-rate-preview.mjs` offers a **separate, admin-JWT-protected POST /ops/shipping/rate-preview**. The endpoint is OFF unless `HOBBYHUB_CARRIER_PREVIEW_ENABLED=true` and the provider test secret is available. It accepts test destination and measured parcel only; the origin and credential are pulled from a server-side AWS Secrets Manager secret. It returns rate options with no street/recipient data or secret.
- `src/components/CarrierRatePreview.jsx` is in the admin Order command center. With no configured `VITE_CARRIER_PREVIEW_API_BASE_URL` it displays an honest disconnected state; if enabled, it supports manual test address/parcel entry and read-only rate comparison. **Do not use actual customer addresses in test mode.**

## Why test rates are not production checkout rates

EasyPost test-rate data is for development; production accounts and discounts can differ. A real shopper checkout needs:

1. Merchant-owned **measured packaged weight/dimensions for every sellable product** including protection and handling materials. Some items will require custom packaging; no guessing dimensions or bundling different products.
2. Verified ship-from address and approved carrier accounts/services. The initial policy permits only the 50 U.S. states and DC, excluding territories/APO/FPO and pickup.
3. A public rate-quote endpoint that loads the actual cart by immutable `productId`, rechecks unique SKU and Stock V2 availability, chooses a server-managed packing plan, and performs rate lookup. The shopper must never supply an arbitrary weight, rate or subtotal.
4. Server-stored, expiring, idempotent rate-quote identifiers bound to cart hash, address, package sizes, carrier accounts and shipping mode. Retry/reprice before payment; no client-authored quote trust.
5. Tax calculation, inventory reservations, signed Stripe webhook processing and refunds before live payment. **Never infer a successful charge from a browser redirect.**
6. An auditable **label-buying workflow** restricted to paid, verified domestic orders, with explicit owner approval and confirmed postage cost. No label purchase service is implemented.

This phase does NOT add AWS costs unless the merchant elects to deploy the sandbox (Lambda/API Gateway/Secrets Manager usage may incur charges).

## Proposed optional AWS sandbox setup (requires owner authorization)

File: `aws/carrier-preview/template.yaml`. This is a **new isolated stack**, not a change to existing Hobby Hub API or DynamoDB. Everything defaults OFF.

- Admin JWT configuration uses the *existing* verified Cognito user pool/client; do not guess identifiers.
- Set up an EasyPost account and obtain a **test API key**. Store it **only in Secrets Manager**, in a dedicated secret containing:
  ```json
  {"apiKey":"<EasyPost TEST key>","origin":{"recipient":"Test Merchant","line1":"Example Test Street","city":"Example","state":"MA","postalCode":"00000","country":"US"}}
  ```
  This is an illustrative schema, **not a real or verified shipping address**. Use a valid test-origin address from your provider when configuring the sandbox.
- Pass only the secret ARN into the stack; do not paste keys into GitHub, ChatGPT, Vercel VITE_* variables, or CloudFormation parameters.
- Validate/review the CloudFormation change set, and deploy to a sandbox environment with `EnableCarrierPreview=false` first.
- Enable the backend test-rate preview only after credentials and service permissions are verified, then configure `VITE_CARRIER_PREVIEW_API_BASE_URL` for an approved authenticated preview build.
- Use **test** addresses only; no customer PII, no shipped orders, and no real carrier label purchase.

## API references

- EasyPost Shipments: https://docs.easypost.com/docs/shipments
- EasyPost Parcels: https://docs.easypost.com/docs/parcels
- EasyPost Rates: https://docs.easypost.com/docs/shipments/rates
- EasyPost Authentication: https://docs.easypost.com/docs/authentication

## Merchant decisions pending

- Which shipping aggregator/carrier provider (EasyPost is only the initial optional test adapter, not a commitment)?
- Physical ship-from location, packaging materials, and weighed/packed sizes for singles, sealed card products and used games
- Eligible domestic carriers/services, handling time, and insurance/signature thresholds
- Returns, damaged items, and tax configuration

No live payment configuration was changed by this work.
