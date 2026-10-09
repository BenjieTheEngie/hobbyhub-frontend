# Hobby Hub — Stripe V2 staging checklist (test payments OFF by default)

**Internal release checklist.** No resources, accounts, Stripe endpoints, sessions, customer payments, invoices, tax transactions or production changes have been created as part of this document. Stripe remains the provider; the old SKU-keyed checkout is permanently quarantined.

## Authenticated baseline (October 9, 2026)

- **Stripe:** connected `Hobby Hub sandbox` (`livemode:false`), zero Checkout Sessions, zero configured webhook endpoints in read-only initial listings. Do not treat an empty sandbox as tested integration.
- **GitHub:** PR #55 and #56 merged with passing offline code and infrastructure checks. Raw-body SDK signature and component-wise payment totals can be reviewed in isolated pure test code.
- **AWS:** original Inventory is the stock authority keyed by productId. Original account connection presents root principal; no isolated Checkout V2/Stock V2/order-event stacks deployed. Legacy source data untouched.
- **Vercel:** team access to `benjietheengies-projects` returns 403, so actual production build and feature gates cannot be verified through connector. Site may be browsable but payment must remain OFF.

## Staging implementation order (do not skip)

1. **Infrastructure and identity.** Owner provisions and verifies least-privilege AWS deploy identity and dedicated Cognito administrator authorization. Read-only inspect original tables; use isolated staging stack names, retained/PITR test tables, test-only Stripe endpoint secret in AWS Secrets Manager, no public `VITE_` credentials. Validate IAM permissions per Lambda (webhook cannot scan or write original Products/Inventory).
2. **Order and stock ledger.** Deploy empty staging Stock V2, Order V2 and durable Stripe event-ID tables, each with explicit key schema, PITR, retention and appropriate encryption. Write/initialize flags start OFF. Prove opening stock against source by productId with a staged non-production copy and cross-channel freeze plan; never auto-migrate 301 original units. Require atomic idempotent checkout reservation and settled/expired order state transitions.
3. **Carrier + Stripe Tax.** Merchant supplies real packed dimensions/weight and U.S. ship-from location; carrier service issues an authorized per-destination quote bound to orderId, destination digest, parcel digest and expiry. No test EasyPost rates in chargeable sessions. Confirm Stripe Tax registration and correct final total with state-specific tests including Alaska/Hawaii, supported DC and blocked territories/military mail.
4. **Session creation (test mode only).** Server reads immutable prices and verified reservations, deduplicates checkout requestId, and creates test Stripe-hosted Checkout Session with USD cart details and matched signed `client_reference_id`/`metadata.orderId`. It must record the returned session ID atomically before exposing the hosted URL; handle Stripe API timeouts or ambiguous session creation without releasing already reserved stock.
5. **Webhook route (test mode only).** Only after a separate secure endpoint is created: verify raw body + `Stripe-Signature` with the official SDK under strictly separated TEST signing secret. Do not log bodies, addresses or payment credentials. Require signed event ID, Stripe Session and immutable order match, server/Stripe subtotals/shipping/discount/tax/final charge, U.S. address binding, state/version and event fingerprint; atomically persist replay event and order transition.
6. **Settlement and shipping.** Paid-before-expiry must transactionally settle held stock exactly once. Completed-but-unpaid, failed, expired or duplicate events do not trigger shipment. Late paid events and mismatched quote/tax/stock cannot auto-fulfill or silently refund; queue operator review. Shipment labels require a separately authorized, payment-confirmed carrier step and exact order/tracking reconciliation.
7. **Provider account and end-to-end tests.** Only after a stable staging URL exists, owner adds **test** Stripe endpoint for required Checkout session events. Exercise test cards (including failure and async flows as supported), duplicated/reordered webhooks, delayed provider event, retries/timeouts, expired reservation concurrent purchase, cancel and refund, shipping/tax changes, same SKU different productId, and last-unit racing orders. Repeat with mobile Safari and Vercel preview branch.
8. **Production release:** document legal business contact, privacy, returns/refunds, support, delivery promises and tax nexus; verify AWS IAM, secrets, audit trails and deployment rollback. Require a documented owner-approved go/no-go with a separately reviewed transition from TEST to LIVE. Do NOT switch an old Lambda, Stripe key or frontend flag alone.

## Never do these

- Do not enable `backend/checkout.mjs` or its old SAM Stripe resources: it uses SKU as physical DynamoDB partition key and would corrupt source stock.
- Do not initialize, migrate or decrement original Products/Inventory or Stock V2 from a guessed count, or use Vercel client variables for Stripe secrets.
- Do not treat browser success URLs, unsigned customer events, a locally entered paid status, or Stripe's mere API connection as proof an order may ship.
- Do not mistake successful Node.js test suites, SAM build checks or GitHub Vercel integration status for a verified live checkout.
- Do not create a public Stripe webhook endpoint or activate merchant charges while the staging event ledger is absent.

**Code references:** `backend/stripe-sandbox-webhook-boundary.mjs`, `backend/stripe-test-session-total-audit.mjs`, `backend/payment-webhook-review.mjs`, `backend/checkout-v2-core.mjs`, `backend/checkout-reservations-v2.mjs`. The Stripe-only integration remains source/test-mode work.
