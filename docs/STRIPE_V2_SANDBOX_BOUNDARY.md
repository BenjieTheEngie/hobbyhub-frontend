# Stripe Checkout V2 — test-mode signed webhook boundary

**Source-only, not deployed, no payment or order writes.** This update keeps Stripe as Hobby Hub's intended payment provider. The original legacy SKU-keyed checkout, webhook and reconciliation handlers remain deliberately quarantined and **must not be re-enabled**.

## Connected sandbox check on October 9, 2026

The connected Stripe context was **Hobby Hub sandbox**, `livemode:false`. A read-only list of the first 10 Checkout Sessions returned **zero sessions** (has_more=false). No Checkout Session, payment, product, invoice, customer or webhook endpoint was created through Stripe. This is not proof that a configured Stripe webhook is live.

## Signed event adapter

`backend/stripe-sandbox-webhook-boundary.mjs` exposes a **server-only** `verifyStripeSandboxEnvelope({request,stripeSdk,webhookSigningSecret})` function. No exported Lambda/HTTP handler invokes it, and no secret is committed. The future authenticated backend must acquire the sandbox endpoint signing secret from AWS Secrets Manager, instantiate a trusted official Stripe SDK, and pass the ORIGINAL API Gateway POST request body and Stripe-Signature header. The SDK verifies the raw-body HMAC and 300-second timestamp tolerance. This module then:

1. Rejects missing, repeated, oversize or malformed headers/bodies, corrupt base64, wrong HTTP method and absent test signing secret.
2. Requires a signed test-mode Checkout Session event with an allowed type and `cs_test_` session ID, USD cents, payment mode and an exact immutable orderId match between the signed `client_reference_id` and signed `metadata.orderId`.
3. Produces a redacted minimal event: event ID/type, test session ID, order ID, provider payment status, currency and integer amount. It excludes customer email, shipping address, card and provider secret.
4. Returns signature-validation provenance for the existing `reviewSignedTestPaymentEvent` offline helper. **Every action flag stays false**, including charge, fulfillment and stock write authorization.

Tests include mock HMAC signature-contract unit tests with tampering, absent/duplicate headers, content-size bounds, correct API Gateway base64 byte preservation, wrong order/session and paid/unpaid/expired cases. The separate `Stripe sandbox signature checks (no network payments)` GitHub Action installs the official Stripe SDK and tests actual signature verification, an altered body, incorrect signing secret and aged signing timestamp **without contacting any Stripe endpoint**.

## Remaining mandatory integration steps

- Create a separate isolated, owner-approved **test-only** V2 webhook Lambda and API route behind intended Stripe event delivery, with test-only endpoint secret in AWS Secrets Manager, safe origin/logging and a strict route size cap.
- Read the server-authored order from a dedicated V2 order table, verify exact Stripe Session/PaymentIntent and complete server-owned subtotal, carrier-shipping, tax and final total. The browser must never supply authoritative totals.
- Atomically claim event IDs in a durable Stripe event ledger and compare event fingerprints; enforce versioned order transitions and Stock V2 reservation/settlement or release, with duplicate, reordered and late-payment controls.
- Keep original Inventory table as physical stock authority until a separately approved cutover with rollback. The user has not authorized new Stripe sessions, customer charges, AWS V2 stock writes, tax/quote assumptions or a new infrastructure deployment.
- Merchant must supply accurate U.S.-only verified carrier-calculated shipping and tax and finalize shipping/returns/privacy policies. Signed Stripe event alone does not prove sellable inventory.
- Owner must move AWS access off root and restore Vercel team scope access. Current Stripe sandbox connection alone cannot fix these blockers.

**No live payment activation.** Neither this adapter nor the unit tests creates a checkout, confirms a charge, modifies the original seven Products or their 301 recorded units, or purchases a label.

Further references: `docs/STRIPE_WEBHOOK_TEST_PLAN.md`, `docs/PAYMENT_WEBHOOK_RECONCILIATION.md`, `docs/LEGACY_CHECKOUT_QUARANTINE.md`.
