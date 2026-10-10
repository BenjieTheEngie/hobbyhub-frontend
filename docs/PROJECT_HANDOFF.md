# Hobby Hub — project handoff / restart guide

> **Last checked:** 2026-10-10 UTC, including merged Checkout V2 source-only work and prior live two-table Stripe ledger verification (see latest updates below). Intended as a durable reference for continuing development in a **new ChatGPT conversation** when the original chat becomes too long.
>
> **Authoritative source:** GitHub repository `BenjieTheEngie/hobbyhub-frontend`, branch `main`. Do not rely on this document instead of checking current GitHub commits, CI results and actual AWS resources before changes.

## Overnight no-cost security continuation — latest merged PRs #74–#76 (2026-10-10 UTC)

**This section supersedes older notes about the Stripe settled-event replay path and shipping quote identity.** Latest merged main SHA at this checkpoint: `29b08363eaabff0754f321160f3e8d5aeab13c28`.

- **PR #74** (`327bea37`, required CI green): source-only `backend/stripe-test-event-inbox.mjs` now rejects a replayed `SETTLED` event unless the **actual server-owned Order V2 snapshot is PAID**, payment is PAID, original payment event/session and USD total match the signed Stripe event and server-retrieved complete/paid test-mode Checkout Session, a valid payment intent exists, and current order version is at least the receipt's settled order version. Legitimate no-write replay after paid fulfillment remains possible. Stored settled receipts must bear verified positive payment dispositions; malformed or mismatched rows fail closed. Comprehensive replay negative tests included.
- **PR #75** (`3bdedb39`, required CI green): checkout request idempotency hash now binds the server-generated **full shipping destination HMAC**, distinct provider rate IDs, quote expiry, rate mode and commitment flags, not merely region and total shipping price. Source-only `buildReservationTransactions` preserves these details for a future **confirmed** carrier quote; malformed HMAC, missing carrier IDs, unapproved address or a quote expiring before the hold ends fails closed. Existing fixed-rate quotes remain `paymentReady:false` offline plans; no raw addresses in durable quote ledgers. Future backend must independently verify the carrier response and create the HMAC using a secret server-only key; caller-supplied fields alone are not proof.
- **PR #76** (`29b08363`, required CI green): confirmed quote requires exactly **one carrier rate per physical packed unit**, a matching `ratedParcelCount` with up to eight distinct provider rate IDs, and `carrierRateDetails` in the same order with positive integer prices summing **exactly** to shippingCents. Quote hash and future immutable order snapshot include the per-parcel rate details. Consolidated packing is **not yet built**; do not assume one label covers multiple units. Tests reject missing parcels, incorrect sums and conflicting rate allocations with the same overall price.
- **All three PRs changed source code, tests and docs only.** No new AWS Lambda/API/DynamoDB tables were deployed; no IAM role/policy was attached, no original product/inventory records were changed, and no Stripe checkout was enabled or shipping labels bought. GitHub's CI ran as part of merges. Previously verified AWS has only the two separate, encrypted/PITR Stripe sandbox test ledgers; **re-check actual AWS state before asserting current record counts or cost balances**.

**Merchant rule:** Continue no-cost code work without asking at every step, but **ask for explicit approval BEFORE any action that could generate charges** (AWS, Stripe, carrier APIs, labels, usage-based Vercel/GitHub upgrades, etc.). Promotional credits do not cap spending. Owner currently prefers deferring AWS Budgets until credits are depleted.

**Next real blocker:** Actual Orders V2/Stock V2 sandbox creation and a dedicated Stripe test-only Lambda/data-plane IAM role are not authorized merely by these source files. Before requesting permission, independently verify whether the proposed `HobbyHubCheckoutV2SandboxCfnExec` IAM role exists; last handoff noted it did **not** yet exist. The reviewed unassigned IAM JSON and manual preview workflow are in `docs/CHECKOUT_V2_STAGING_PREVIEW_IAM.md`. Any AWS IAM bootstrap or CloudFormation change-set execution must use a vetted **non-root** principal and explicit resource/cost approval. Original stock migration, payments and fulfillment remain disabled.

## Most recent continuation — no-cost Checkout V2 development and approval-before-spend (2026-10-10 UTC)

**Owner's instruction:** Continue coding and testing without unnecessary interruptions; **ask first before executing ANY operation that could incur AWS, Stripe, shipping, carrier API, or other charges**. The merchant has $120 in previously verified AWS promotional credits, but those are **not a hard billing cap**. Budget alerts are deferred at the merchant's preference. This work did NOT deploy AWS resources, attach IAM roles, access paid Stripe features or execute shipping labels. Existing Vercel/GitHub CI may consume included platform usage; confirm before extra pay-as-you-go services.

- PR **#70** merged **`afab3f2a`**: `aws/checkout-v2-sandbox-foundation/template.yaml` is a **source-only, not-yet-deployed** plain CloudFormation manifest for **two EMPTY isolated DynamoDB tables**: `StockV2` keyed by `productId` and `OrdersV2` keyed by `orderId`. On-demand capacity, encryption, PITR and `Retain`; both `EnableCheckout` and `EnableStockMigration` parameters are constrained to `'false'`. All required CI passed.
- PR **#71** merged **`c5400104`**: Proposed IAM draft policies for GitHub OIDC **preview-only** and a separately named, tightly restricted CloudFormation execution role `HobbyHubCheckoutV2SandboxCfnExec`; a manual-only `.github/workflows/aws-checkout-v2-foundation-preview.yml` can prepare an **unexecuted** change set after the roles are bootstrapped, but must NOT be run before approval. Twelve **read-only** AWS policy simulations showed correct staging Allow/Deny decisions. **No policies attached and no execution role created** during this work. No deployed new Checkout V2 stack. All CI passed.
- PR **#72** merged **`b44eb131`**: Pure **offline, non-executable** `backend/stripe-test-atomic-capture-plan.mjs` composes version/quantity-conditioned stock capture, reserved-order `PAID` transition and existing signed event-receipt `PENDING_REVIEW → SETTLED` update in **one proposed DynamoDB transaction**. It rejects mismatched/expired/duplicate evidence and production table names. The Stripe TEST inbox can now process already-settled signed replay events against PAID orders as NO-WRITE receipts, with fingerprint/session and durable settlement metadata validation. No AWS writes or actual payment/stock capture. All CI passed.

**Current verified deployment remains the separate Stripe sandbox ledger stack only**, with two encrypted/PITR test tables initially empty; original production Products and Inventory tables previously verified at 7/7 rows and 301 units and were not modified by these code actions. Treat quantities as last-read values, not real-time counts. Legacy checkout quarantine stays in force, live payments are disabled, and no Order V2/Stock V2 table, Stripe webhook Lambda/endpoint or production Checkout V2 activation has occurred.

**Actual next roadblock:** the user must complete/review a **separate** non-root staging IAM bootstrap for the preview-only Checkout V2 roles and then provide explicit action-specific approval before preparing or executing anything with possible costs. Details: `docs/CHECKOUT_V2_SANDBOX_FOUNDATION.md`, `docs/CHECKOUT_V2_STAGING_PREVIEW_IAM.md` and `docs/STRIPE_TEST_ATOMIC_CAPTURE_MODEL.md`. Confirm actual AWS account/region `349744180170` / `us-east-2` again before action. Do NOT attach broad AdministratorAccess, deploy through root-connected AWS Core, migrate stock or enable payment collection just to meet a launch deadline.

## Checkout V2 continued — signed test webhook inbox and pinned data IAM draft (2026-10-10 UTC)

**Newest merged work supersedes earlier paragraphs saying no webhook inbox adapter is written.** Actual AWS staging infrastructure is still ONLY the two empty Stripe ledger tables described below. These changes are source/tests and documentation, not Lambda/webhook deployments:

- PR **#66**, merged `d2a0c337`, all required CI green: `backend/stripe-test-event-inbox.mjs` validates the signed Stripe TEST event, immutable order/provider totals, Stripe Tax, signed full-address shipping quote and persisted replay fingerprint; then uses an injected client for **strongly consistent GetItem** and **conditional PutItem** into ONLY the exact Stripe TEST event ledger name. New records remain `PENDING_REVIEW` and are not settled; replay, concurrent delivery, collisions and DB failure are fail-closed. `backend/stripe-v2-reconciliation.mjs` exposes its verified event fingerprint.
- PR **#67**, merged `b6b2fc4d`, all five required CI green including real **official Stripe SDK** signature integration: `backend/stripe-test-session-fetch.mjs` uses the verified raw webhook's `cs_test_` ID to call the trusted server-side Stripe SDK `checkout.sessions.retrieve`. Client-supplied Checkout Session objects cannot replace the provider response; signature checks occur before provider/API lookup or DynamoDB activity.
- PR **#68**, merged `5f23b80a`, all CI green: adds an exact physical event-ledger **draft IAM GetItem/PutItem policy** `aws/iam/hobbyhub-stripe-test-inbox-ddb-data-policy.json`, scoped to `evt_*` keys with a required leading-key context. A read-only AWS IAM policy simulation allowed exact TEST event Get/Put and denied scans, missing/wrong keys, the checkout request ledger and the original Inventory table. **Policy is NOT attached to any AWS role.** No new AWS writes occurred.
- **Deployment blocker:** source-only code is NOT an AWS Lambda/API Gateway route. Test-mode Stripe endpoint+signing secret and test-key storage, server-authoritative Order V2/Stock V2 snapshots and atomic settlement, isolated IAM Lambda execution role, carrier quotes, production tax/fulfillment tests remain absent. The `HobbyHubStagingDeploy` role still only previews change sets and `HobbyHubStagingLedgerCfnExec` controls tables but cannot read/write items. ChatGPT AWS Core still presents AWS root; DO NOT deploy as root or grant broad roles.
- Owner confirmed AWS promotional credits totaling $120 at original read; credits may pay eligible staging costs. Owner **prefers deferring AWS Budgets until credits run out**. Respect the preference; clearly disclose that promotional credits are **not a hard cost limit** and don't guarantee all charges are covered. No budget created in this work.
- **Business inputs remaining:** shipping origin ZIP, preferred eligible carriers (USPS/UPS), actual packed product dimensions/weights, owner-reviewed eligible SKUs, merchant shipping/refund/tax policies. No live checkout or stock migration without separate explicit go/no-go.

Next safe tasks: isolate an authenticated Orders V2/Stock V2 staging read path and a reviewed Lambda IAM+secrets stack (test only), implement atomic order/stock settlement tied to pending event receipts, test webhook retries and Stripe async paid/expired outcomes. Do not treat event PENDING_REVIEW as authorization to ship or mark paid. Detailed design: `docs/STRIPE_TEST_WEBHOOK_INBOX.md`, `docs/STRIPE_TEST_INBOX_IAM_REVIEW.md`.

## LIVE AWS state update — Stripe sandbox ledgers now deployed (2026-10-10 UTC)

**This supersedes older sections that say no sandbox ledgers are deployed.** The merchant approved and manually executed the exact reviewed CloudFormation change set `hobbyhub-review-38016180343-1`. AWS account `349744180170`, `us-east-2`:

- CloudFormation stack **`hobbyhub-stripe-sandbox-ledgers` CREATE_COMPLETE** with **exactly two tables**, no APIs, webhook Lambda, Stock V2 or Orders V2:
  - `hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S` — `requestId` string key.
  - `hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5` — `eventId` string key.
- Both tables **ACTIVE**, `PAY_PER_REQUEST`, encryption at rest ENABLED, point-in-time recovery ENABLED, and **zero records** confirmed by strongly consistent `Scan(Select=COUNT)`. CloudFormation `DeletionPolicy/UpdateReplacePolicy: Retain`.
- Original source tables **still ACTIVE** with PITR enabled: **7 Products records** and **7 Inventory records totaling 301 `quantityOnHand` units**, strongly consistently read after deployment. No original stock migration or assistant mutation occurred.
- Stack parameters explicitly `Stage=sandbox` and `EnableStripeCheckout=false`. **No Stripe live/test Checkout Session creation, webhook endpoints, server-side payment execution, payment settlement or automatic fulfillment are deployed.**
- Roles already present: `HobbyHubStagingDeploy` with *preview-only* permissions, `HobbyHubStagingLedgerCfnExec` with table **control-plane only**, not item reads/writes. AWS Core connector **still assumes root**; use it READ-ONLY, do not deploy as root.
- Next: cost budget alert and isolated test-only data-plane webhook/order/reservation architecture + IAM review and owner approval for additional AWS costs/stock writes. Do not rerun the new-stack-only preview workflow after stack creation.

Detailed authoritative verification: `docs/STRIPE_LEDGER_DEPLOYMENT_VERIFICATION_20261010.md`. This section takes precedence over older dated rollout instructions in the handoff.

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

## Verified latest prelaunch audit — 2026-10-09

- Merged **PR #53** as `604f5206` after frontend and AWS offline CI success: `docs/PILOT_FULFILLMENT_SOP.md` defines a human-controlled order-to-shipping, cancellation/refund and daily reconciliation process; `docs/PILOT_CUSTOMER_POLICIES_DRAFT.md` marks all merchant handling/returns/privacy/tax policy decisions **unapproved**, not ready to post publicly.
- Fresh **strongly consistent read-only** original Products/Inventory scan again verified **7 + 7 linked records and 301 on-hand units**, preserving all originals. ALL seven original Product entries are ACTIVE but have **no imageUrl, no condition, no recognized shippingPackage, and no explicit published:true**; the records should not be considered sale-ready. Data is a point-in-time legacy database count, not a physical count or stock allocation. See `docs/OCTOBER_16_PILOT_GATES.md`.
- Verified direct Vercel queries for project, deployment and custom domain all returned the same **403 unauthorized team scope**. Vercel team enumeration returned **0 teams**. The site URL responds but its alias SHA and production flags remain unverified; **owner must reauthorize correct team membership/connector**. No root-based AWS deploy, payment activation, catalog approval, stock migration or shipping-label purchase was attempted.

## Stripe-only continuation completed — 2026-10-09 (PRs #55 and #56)

**Merchant confirmed continued use of Stripe, not Square.** Connected Stripe account context was `Hobby Hub sandbox` (`livemode:false`). Read-only Stripe API calls verified **0 Checkout Sessions** and **0 configured webhook endpoints** in this sandbox. No sessions, charges, invoices, products, customers or endpoints were created. Do not confuse account connection with a deployed checkout integration.

- **PR #55** merged at `621e542e` after successful frontend, AWS offline, SAM validation/build and official **Stripe SDK cryptographic signature CI**. New `backend/stripe-sandbox-webhook-boundary.mjs` validates POST, Stripe-Signature, exact raw body/base64, timestamp, test-only Checkout session, immutable orderId, supported event types and USD amount; strips customer PII and returns a **non-executable** review envelope. No Lambda route, Secrets Manager operation, endpoint or DynamoDB mutation was deployed. See `docs/STRIPE_V2_SANDBOX_BOUNDARY.md`.
- **PR #56** merged at `2285f452` after **five passing GitHub checks**. New `backend/stripe-test-session-total-audit.mjs` checks a trusted server-retrieved Stripe TEST session versus a trusted reserved V2 order, including item subtotal, carrier shipping, Stripe Tax, zero discounts, total cents, immutable orderId, test mode, 50-states+DC destination state/ZIP and late-payment handling. Returns **all write and fulfillment authorizations FALSE**; no network call/payment. See `docs/STRIPE_TEST_SESSION_TOTAL_RECONCILIATION.md`.
- **Hard blockers:** no deployed V2 order/reservation/order-event tables/routes/webhook, root-only AWS connector identity unsuitable for deployment, original Products/Inventory stock still legacy, no completed Stripe shipping/tax pricing flow, no configured Stripe test webhook endpoint, no approved catalog items/package measurements, and Vercel team project/deployment/domain lookups remain 403. **Never enable legacy checkout** or collect live payments as a workaround.

**Next recommended technical steps:** obtain least-privilege AWS deploy role and verified Cognito admin identity, restore Vercel team connector, stage isolated Stock V2/Order V2 and durable webhook event table with writes OFF initially, prove live carrier-calculated quote and Stripe Tax final-total contract, implement idempotent sandbox Checkout Session creation and authenticated signed webhook handler, run end-to-end failure/retry/refund tests, then obtain explicit owner go/no-go before any real transaction.

## October 9 later staging update: $120 credits and preview-only IAM boundary

- The merchant offered up to **$120 in AWS promotional credit** for necessary staging expenses. Verified by AWS `billing:GetCredits`: **$100 + $20 ENABLED** promotional credits, both reporting full remaining balances and expiring April 20, 2027 UTC. Credits include DynamoDB/Lambda/API Gateway/CloudFormation/Secrets Manager in eligible products. AWS Budgets `DescribeBudgets`: **zero budgets configured**. AWS Cost Explorer `GetCostAndUsage`: denied because Cost Explorer access isn't enabled. **Don't claim unbilled cost is zero, or that credit prevents an AWS invoice.**
- Proposed conservative owner-managed **$25 monthly AWS Cost Budget** with $10/$20 actual-spend email alerts. Not yet created; merchant must designate the monitored recipient in Billing console. Budget alerts **do not cap charges**.
- Initial review-only `HobbyHubStagingDeploy` IAM draft is tightened to **exclude** `cloudformation:CreateStack`, `cloudformation:ExecuteChangeSet` and `cloudformation:UpdateStack`, preventing an enabled GitHub workflow from provisioning ledger resources before explicit change-set review. New `.github/workflows/aws-stripe-ledger-preview.yml` is **manual only**, requires exact confirmation and main-branch OIDC trust, and may create **one unexecuted** CloudFormation change set for exactly two empty sandbox tables. It has no execute/deploy step. No workflow run is being triggered until role permissions/CloudFormation executor are securely bootstrapped.
- A read-only AWS `SimulateCustomPolicy` check for the tightened GitHub draft returned **ALLOW CreateChangeSet in staging**, **DENY ExecuteChangeSet**, **DENY production stack changes**. No IAM policy was attached, no IAM executor created, no AWS tables created. **Current AWS Core connector still uses root**, and must not be used to deploy. Follow `docs/AWS_STAGING_BOOTSTRAP_AND_BUDGET.md` for owner-operated privileged IAM setup and budget alerts.
- GitHub source safety changes PRs #59–#62 remain merged; original productId-keyed Products/Inventory and all 301 reported units remain untouched, and live/test Stripe processing services remain undeployed.

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
