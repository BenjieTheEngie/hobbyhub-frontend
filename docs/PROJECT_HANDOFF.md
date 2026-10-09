# Hobby Hub — project handoff / restart guide

> **Last checked:** 2026-10-09. Intended as a durable reference for continuing development in a **new ChatGPT conversation** when the original chat becomes too long.
>
> **Authoritative source:** GitHub repository `BenjieTheEngie/hobbyhub-frontend`, branch `main`. Do not rely on this document instead of checking current GitHub commits, CI results and actual AWS resources before changes.

## Read this first in a new chat

Continue building Hobby Hub, a U.S.-only e-commerce site for trading-card singles/sealed products, tabletop items, collectibles, and secondhand video games. User wants to keep developing proactively, requesting input only when needed. **Preserve working legacy inventory CRUD and all historical product/inventory data. Keep live payments, automatic publication, AWS stock migrations and shipping-label purchases DISABLED until an independently tested, explicitly authorized launch.** Prefer safe isolated improvements, GitHub feature branches/PRs, tests, and verified deployments.

Site: **https://hobbyhub.company**

Repository: **https://github.com/BenjieTheEngie/hobbyhub-frontend**

### Security and source-of-truth rules

1. Original **Products** and **Inventory** DynamoDB tables are both keyed by **`productId` (string)**. **SKU is a label, not a guaranteed physical key**; historic duplicates existed. Never use SKU for original DynamoDB Get/Put/Delete keys.
2. Original Inventory is the **current physical stock authority**, with `quantityOnHand`, `reorderPoint`, and `updatedAt`. Original Products generally do **not** contain reliable stock counts; missing quantities are **UNKNOWN**, not zero.
3. Legacy product create/update/delete and inventory adjust routes have been reported working. Never break them during a migration. Current legacy delete may be destructive; existing frontend has extra confirmation safeguards.
4. The separate Stock V2, customer order, shipping preview, and public catalog AWS infrastructure are **source-ready but have NOT been confirmed as deployed**. No automatic Stock V2 population occurred.
5. **`published:true` must be explicit** for a public listing. In the last AWS audit all seven Products were `status:ACTIVE` but none contained the explicit `published` approval flag. Do **not** mass-publish.
6. Stock V2 schema requires explicit nonnegative integer `onHand`, `reserved`, `reorderPoint`, and positive integer `version`. Available-to-sell = `onHand - reserved`. Unknown or malformed rows fail closed. Stock V2 initialization/adjustments are disabled by default in both AWS and frontend config.
7. Checkout remains **NOT LIVE**. Existing `backend/checkout.mjs` is unsafe against physical productId keys. Checkout V2 remains an offline/non-payment architecture: no signed Stripe webhook, final tax/total, idempotent order processing, reservation release/capture or actual charging.
8. Merchant has confirmed **U.S.-only shipping to 50 states + DC, shipping only, no local pickup**, excluding international destinations, territories and APO/FPO in the first launch. Selected **carrier-calculated shipping** from actual packed dimensions, weight and destination; do not invent shipping prices.
9. EasyPost implementation is **test-mode only**, optional, administrator-gated, and cannot purchase labels or authorize payment. No real carrier credentials should be committed or placed in public `VITE_*` frontend variables.
10. Current AWS access via AWS Core was previously identified as using a **root principal**. Before broader deployments, transition to **least-privilege** scoped access. Never paste or log secrets.

## Verified AWS resources and backup state (2026-10-09 audit)

**AWS account:** `349744180170`. **Region:** `us-east-2` (Ohio).

- Products table: `hobbyhub-ProductsTable-KC31XDEOENBG` — `productId` HASH string; **7 records** at last audit.
- Inventory table: `hobbyhub-InventoryTable-X2IRQDAGW7WB` — `productId` HASH string; **7 linked records, total 301 on-hand units** at last audit.
- Supplier and PurchaseOrder tables exist, but were reported with no records at last inspection.
- Existing Products Lambda: `hobbyhub-ProductsFunction-BxImcqVEDKKV`, Node.js 20 at last inspection.
- Existing HTTP API Gateway: `13bdy276e1`, root `https://13bdy276e1.execute-api.us-east-2.amazonaws.com`.
- Original API has `POST /inventory/{productId}/adjust`; at last inspection no dedicated GET inventory route.
- Existing Cognito user pool `us-east-2_5QRb2tWcT`; public app client `9qrtgdn5dtoqhc3brmr03mgn0`; authorizer name `CognitoAuthorizer`. **No Cognito groups existed** at the last read-only check. New admin JWT routes require verified admin configuration/group/allowlisted user; do not bypass authentication.
- **Explicitly authorized and COMPLETED:** one independent on-demand backup for EACH original Products and Inventory table; both backups confirmed **AVAILABLE**. **PITR enabled on both**, confirmed by subsequent DescribeContinuousBackups. A final scan verified original 7/7 records and 301 units remained intact. Backup and PITR may incur AWS charges.
- Do not re-create backups or change other infrastructure simply because they are described here; inspect current state, cost, permissions and necessity.

## Architecture

### Frontend and current hosting

- React 19 + Vite 8; Vercel project `hobbyhub-frontend`, team `benjietheengies-projects`.
- User upgraded Vercel to **Pro** on 2026-10-09. GitHub-triggered Vercel builds resumed after earlier Hobby build-rate caps.
- Preview/production *build status* does not, by itself, verify which Git commit is bound to the **`hobbyhub.company` production alias**. Check Vercel domain deployment directly if the Vercel plugin has correct team permission. API authorization previously returned 403 despite successful GitHub-initiated deploys.
- Storefront supports saved products, saved-only and availability filters, sort, shopping-list cart. Public catalog is gated by `VITE_PUBLIC_CATALOG_URL`; without valid explicitly published and stocked listings, do not fabricate public inventory.
- Admin has inventory workspace, guarded legacy product CRUD, local packaging measurements editor (browser localStorage only), CSV packaging worksheet, read-only order dashboard and optional carrier rate preview.
- Browser-local measured packaging is NOT authoritative AWS product data, and not synchronized across devices. Export CSV for backup. Only a future authenticated shipping-profile import can approve these profiles as server-side rate inputs.

### New code implemented and merged by 2026-10-09

- Stock V2 isolated AWS SAM template `aws/stock-v2/template.yaml`; admin handler `backend/stock-v2.mjs`; pure rules `backend/stock-v2-logic.mjs`; public catalog `backend/catalog-v2.mjs`. An entirely **separate** stock table and audit table with Retain/PITR in template, JWT admin API and read-only public catalog. All writes OFF by default.
- Read-only inventory migration review: `backend/stock-cutover-review.mjs`, `scripts/stock-cutover-preflight.mjs`, `docs/AWS_STOCK_CUTOVER_PREFLIGHT.md`. Checks verified full scans, keys, balances, SKU duplicates, PITR/backups and drift hash. **No write/migration code executed.**
- Read-only original legacy Inventory view: `backend/legacy-stock-read.mjs`, `backend/legacy-stock-read-logic.mjs`, `src/components/LegacyStockReadPanel.jsx`, `aws/legacy-stock-read/template.yaml`. Optional new admin GET `/ops/legacy-stock` behind JWT, Scan-only IAM permission. Source merged, **not deployed** as of last check.
- Order operations foundation: `backend/order-ops.mjs`, `aws/order-ops/template.yaml`, `src/components/OrderWorkbench.jsx`. Read-only order views; separate customer orders from supplier purchase orders; **no live order API has been deployed**.
- Checkout V2: `backend/checkout-v2-core.mjs`, server-verified immutable `productId`, SKU uniqueness, strict positive price and stock checks, pure reservation transaction plans. **Not a live handler**, not a payment service.
- Shipping: `backend/shipping-v2.mjs`, `backend/carrier-rating-v2.mjs`, `backend/easypost-test-rates.mjs`, `backend/carrier-checkout-preview.mjs`, `backend/fulfillment-v2.mjs`; U.S.-only rules, merchant-measured parcel dimensions/weights, test-only carrier quotes, paid-only pure fulfillment state transition plans. Still no real Stripe or postage purchases.
- Optional admin-only test rate preview: `backend/carrier-rate-preview.mjs`, `aws/carrier-preview/template.yaml`, `src/components/CarrierRatePreview.jsx`; AWS Secrets Manager reference and backend preview flag default OFF. Not connected to live shipping.
- Latest Stock V2 hardening via **PR #27**: `verifiedStockRows` rejects malformed/duplicate `productId` stock records instead of silently dropping them from admin/public snapshots. Merged after GitHub frontend and AWS offline tests plus successful Vercel preview checks.

### Recent merged PRs

- PR #14: Stock V2 infrastructure/guarded UI (first major stock build)
- PR #15: storefront saved items and fail-closed public catalog
- PR #16: read-only order operations foundation
- PR #17: Checkout V2 guarded reservation model
- PR #18: U.S.-only shipping and guarded fulfillment
- PR #19: EasyPost test-only carrier preview and measured shipping foundation
- PR #20: packaging measurement worksheet
- PR #21: deployment checklist and Vercel Pro deployment retry
- PR #22: server-side verified cart → packing → carrier test-rate quote preview
- PR #23: browser-only packaging measurement editor
- PR #24: reserved stock accounting / correct available units
- PR #25: fully read-only stock migration preflight / drift fingerprint
- PR #26: optional read-only legacy Inventory admin bridge
- PR #27: fail-closed Stock V2 snapshot integrity checks

All were merged to `main` in prior work; check current GitHub state/CI before further action.

## Current outstanding roadmap (priority order)

1. **Verify current prod release vs GitHub main.** Ensure Vercel READY production alias points to latest commit, test storefront/admin and no payment activation. Check connected Vercel team authorization (403 may still occur).
2. **AWS security hygiene:** create/verify an appropriate least-privilege deployment identity/role and an authorized admin Cognito group or approved allowlisted admin subject. Never assume empty Cognito group list means anyone is admin.
3. **Stage isolated Stock V2 safely** after owner approval to create new AWS resources/costs. Validate SAM templates, IAM policies, Cognito JWT, DNS/CORS, nonadmin denials, GET list and catalog. Leave both backend write/initialization flags FALSE. No publishing/checkout.
4. **Reconcile legacy stock:** repeat read-only preflight and compare all current quantities, record IDs and backups immediately before any approved migration. Decide how to avoid two concurrent stock authorities. Migration executor must be idempotent and conditional, preserve existing legacy tables, and come with rollback tests. Stock V2 currently has NO deployed or populated source confirmed.
5. **Staging publication policy:** explicitly review image, price, SKU, condition, metadata and physical available-to-sell balance; do not bulk publish old ACTIVE products.
6. **Carrier shipping integration:** measure all sellable package profiles, approve actual ship-from address and carrier services; set up provider TEST key securely in Secrets Manager, test rate API. Production rating, expiry, cart-bound quotes, package consolidation and address deliverability checks are future work.
7. **Real checkout safety work:** verified Stripe test-mode sessions, signed and idempotent webhooks, stateful order record, exactly-once reservation/release/capture, pricing/tax, shipping cost, late payment reconciliation, refunds, order lifecycle and authorized shipment. Do not open paid checkout until end-to-end passing staging tests and merchant policy approval.
8. **Operational polish:** customer support, privacy/returns policies, shipping handling time, product detail pages, order tracking, monitoring and alarms, low-stock alerts.

## Environment and deploy flags

Frontend (public at build time; no secrets):

- `VITE_PUBLIC_CATALOG_URL` — optional public verified catalog URL.
- `VITE_STOCK_API_BASE_URL` — optional JWT admin Stock V2 API root.
- `VITE_ENABLE_STOCK_WRITES`, `VITE_ENABLE_STOCK_INITIALIZATION` — UI only, default OFF; backend must separately permit writes.
- `VITE_ORDER_OPS_API_BASE_URL` — optional read-only order API root.
- `VITE_CARRIER_PREVIEW_API_BASE_URL` — optional TEST-mode admin rate preview API root.
- `VITE_LEGACY_STOCK_READ_API_BASE_URL` — optional original Inventory admin read-only API root.

AWS backend safety flags:
- `HOBBYHUB_STOCK_V2_WRITES_ENABLED` and `HOBBYHUB_STOCK_V2_INIT_ENABLED` default false.
- `HOBBYHUB_CARRIER_PREVIEW_ENABLED` defaults false.
- `HOBBYHUB_CARRIER_TEST_SECRET_ARN` references secure Secrets Manager; do not expose the API key to frontend.

## How to resume development in a new ChatGPT chat

Copy this:

> Continue building **Hobby Hub** from `https://github.com/BenjieTheEngie/hobbyhub-frontend`. Read `docs/PROJECT_HANDOFF.md`, verify the latest `main` commit, GitHub CI, Vercel production deployment and AWS status using the linked GitHub/AWS Core integrations. Build proactively in safe branches and merge only passing changes. We have 7 matched Products/Inventory records (301 units at last AWS audit), independent backups and PITR enabled; the original tables key on `productId`. Stock V2 is NOT migrated, new AWS services not confirmed deployed, and checkout/payments must remain disabled. Don't change legacy CRUD, quantities, Stripe, publishing or AWS infrastructure without appropriate approval and verification. Continue from the highest-priority safe task and ask me only for necessary input.

This document should be updated at the end of each meaningful milestone, so context can move across chats without being trapped in a conversation.
