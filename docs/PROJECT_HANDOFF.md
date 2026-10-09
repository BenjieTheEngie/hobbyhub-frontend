# Hobby Hub — project handoff / restart guide

> **Last checked:** 2026-10-09, including merged launch preparation through `767e6be9`. Intended as a durable reference for continuing development in a **new ChatGPT conversation** when the original chat becomes too long.
>
> **Authoritative source:** GitHub repository `BenjieTheEngie/hobbyhub-frontend`, branch `main`. Do not rely on this document instead of checking current GitHub commits, CI results and actual AWS resources before changes.

## Continuation update — 2026-10-09 (after prior handoff)

**Most recent completed work and verified state:**

- PR **#49**, merged as `9300e1d5`: permanently disables the obsolete SKU-keyed Stripe checkout guard, all corresponding legacy payment, webhook, reconciliation and shipment write handlers, and makes the optional media SAM checkout resources impossible to enable. It **does not** change original Products or Inventory CRUD. All four GitHub CI jobs passed (frontend checks, AWS offline checks, SAM lint and SAM staged builds).
- PR **#50**, merged as `88b6a6a5`: offline Checkout V2 requires **explicit `status:'ACTIVE'`** as well as publication approval, with regression tests across carrier quotes and checkout. Four GitHub CI workflows passed before merge, following a test-fixture fix.
- AWS Core read-only re-verification: authenticated principal `arn:aws:iam::349744180170:root` in `us-east-2` (do **not** use for new infrastructure changes). Both original DynamoDB tables ACTIVE, `productId` keys, 7 records each with 7 linked IDs and **301 units**; zero explicit `published:true` in Products; independent AVAILABLE backups and PITR ENABLED. There are **four legacy Node.js 20 Lambdas**, only the original `hobbyhub` CFN stack (besides AWS SAM support stack), and **13 JWT-authorized routes** in API `13bdy276e1`. No extra Stock V2, order, carrier or publication stack/handler was deployed; Cognito group list empty. Original records were only **read**, never mutated.
- GitHub status for main was good, including the Vercel GitHub check, but team-scoped Vercel connector still returns **403** for `benjietheengies-projects`; domain alias/latest deployment commit **not independently verified**. Vercel team membership lookup returned zero teams.
- Owner proposes **Friday October 16, 2026** for active sales. Do **not** interpret the date as authorization to turn on payments or publish stock. Detailed limited pilot **go/no-go gates** and an alternative request-to-buy + externally hosted manual invoice model are in [`docs/OCTOBER_16_PILOT_GATES.md`](OCTOBER_16_PILOT_GATES.md). Fully automated site checkout in one week is not safe based on existing state; only a small supervised sales pilot can be considered, after all gates and owner approvals.
- Old PR #40 was based on a stale checkout branch and was superseded in substance by #50; check whether it remains open before doing new checkout work.

**Next priority:** restore scoped Vercel team access and least-privilege AWS identity, get a clear owner decision on a **manual hosted-invoice pilot versus no paid sales until full automation**, identify a small explicitly approved physical product set and merchant shipping origin/policies. Continue offline code and test hardening without mutating existing stock, deployment or payments.

## Follow-on launch-preparation milestone — 2026-10-09

- **PR #52 merged** at `767e6be9`: added a signed-in admin **Manual sales paperwork audit** that downloads a blank CSV and locally reviews a redacted, operator-created pilot sales worksheet. Strict schema, unique productId/SKU, cross-order invoice/payment/tracking reference checks and missing stock/parcel/U.S. destination/rate/tax/hosted-invoice/provider evidence flags. All rows remain `canCharge:false`, `canShip:false`, `paymentVerifiedBySystem:false` and `inventoryReserved:false`. CSV is never uploaded or persisted; browser cannot charge, reserve or ship. CI passed before merge. See `docs/PILOT_ORDER_WORKSHEET.md`.
- This next documentation milestone adds `docs/PILOT_FULFILLMENT_SOP.md`, an operator-controlled pick/pack/quote/hosted-invoice/provider-reconciliation/returns playbook with explicit stop conditions; and `docs/PILOT_CUSTOMER_POLICIES_DRAFT.md`, **unapproved** drafting guidance for seller contact, shipping/handling, tax, product condition, returns and privacy.
- `hobbyhub.company` responds publicly, but its deployed SHA and production build flags still cannot be independently confirmed because **Vercel team access returns 403**. No new AWS backend, payment, catalog approval, Stock V2 or carrier service was deployed. The original account still needs least-privilege delegation from the root principal.
- **PR #40 has been closed** as superseded by #50. The October 16 target remains **conditional**, with no owner authorization to accept customer money or publish products.
- Next actions requiring the owner's input: authorized Vercel team connection; scoped AWS deployment identity; choose hosted invoice provider and pilot selling scope; ship-from ZIP, measured package profiles, approved carrier services, tax and returns/handling policies. Do not ask for secrets in chat.

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
- Stock V2 hardening via **PR #27**: `verifiedStockRows` rejects malformed/duplicate `productId` stock records instead of silently dropping them from admin/public snapshots. This was an earlier milestone; further work has since merged (see below).

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

These are earlier milestones. **Seventeen more main-branch commits** after #27 are summarized above (the latest observed was `c7c801f6`). Check current GitHub state/CI for any later changes before further action.

## Important: additional main-branch work AFTER PR #27

A live GitHub commit search on **2026-10-09** returned the following **newer main-branch commits**, not included in the earlier PR #14–#27 list. They are **source work**, and do NOT imply corresponding AWS deployments or payment activation. Re-read the actual current code and docs before starting an implementation, to avoid duplicating features or reintroducing unsafe assumptions.

1. `ba24784c` — offline idempotent **paid capture and terminal stock reservation release** plans; not an active Stripe or DynamoDB executor.
2. `7d6e69a2` — admin read-only **publication-readiness** audit and safe public listing checklist.
3. `36743c8a` — offline **checkout request idempotency ledger** and conditional unpaid reservation-expiry release plans, with honest expired-order display.
4. `721b3971` — strict, all-or-nothing **local packaging worksheet CSV import**, so browser-only measurements can be moved between devices after user review; not AWS shipping-profile authority.
5. `131f829f` — isolated **versioned/audited server shipping-profile draft** and default-off JWT-admin API design; separate from original products and payment flow.
6. `1672707b` — offline replay-safe, provider-verified **Stripe webhook reconciliation** decision planner; no live payment processing.
7. `98b467ff` — public catalog requires original **ACTIVE** status and valid integer-cent price.
8. `fda8261d` — safe **public SKU to immutable productId checkout resolver**, preserving ambiguous-SKU exclusion; still no customer payment endpoint.
9. `ff53c4c5` — offline signed Stripe **test-mode event/idempotency blueprint**; not a live webhook or permission to mark orders paid.
10. `fa7d5f74` — unknown stock stays **unknown rather than zero**, and low-stock alerts use available units.
11. `65aad09c` — AWS SAM stack offline build/lint CI, and backend package version packaging fix.
12. `e5d8c18c` — Cognito **fail-closed admin authorization tests** and least-privilege staging guide.
13. `e5b3a7f0` — CI validations for **all six AWS SAM infrastructure templates** without live cloud mutations.
14. `039bc02b` — richer read-only **catalog and carrier checkout launch blockers** in admin.
15. `34f3bdfb` — **separate fingerprint-matched publication approval** table design; legacy Products records remain unchanged by this authorization.
16. `9521043e` — default-off **audited admin catalog approval/revocation** workflow and admin review UI, with optimistic concurrency and duplicate SKU protection.
17. `c7c801f6` — AWS SAM **conditional IAM write policies** so Stock V2/catalog mutating permissions depend on explicit feature-enable flags. This was the newest main-branch commit returned immediately before this handoff PR.

**Do not assume any of these features are active in AWS or that a passing frontend build permits checkout.** Check `main`, Vercel alias, stack list, Lambda function list, IAM, and actual environment variables first. A branch/commit is not a live cloud deployment.

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
