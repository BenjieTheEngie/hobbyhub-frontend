# Legacy Stripe checkout quarantine (2026-10-09)

## Decision

The original optional `backend/checkout.mjs` implementation is **retired and deliberately not executable**. It uses `sku` as a DynamoDB partition key for product reads, reservations and release, while the actual original Hobby Hub Products and Inventory tables both use immutable `productId` keys. Original stock authority is a **different Inventory table**, not product `quantityOnHand`. The old checkout path must not be brought online just by changing environment variables.

## Defenses (source only)

- `stripeCheckoutEnabled()` always returns false regardless of merchant, inventory, schema, Stripe or test-mode flags.
- Public legacy checkout start/status and signed webhook handlers return a 503 before contacting Stripe or writing DynamoDB; scheduled legacy reconciliation rejects. Existing legacy merchant order shipment mutation also rejects.
- The optional `aws/media-addon/template.yaml` has an `EnableLegacyCheckoutInfrastructure` parameter with **only `false` permitted**. Conditional legacy Orders/Checkout/Webhook/Reconcile resources cannot be created even if Stripe secret ARNs are supplied and `EnableCheckout` is changed. Do not remove the guard without a security review.
- Legacy Products/Inventory CRUD and the independently gated `productId` inventory write configuration are **unchanged**. The original production AWS stack and database are untouched.
- These changes are preventative source controls. They do not certify what version currently serves the Vercel production alias or prove any new AWS stacks are installed.

## Authorized development route

Continue using **Checkout V2** as an offline-only design. Before introducing a live endpoint, require a separately scoped deployment identity, verified Cognito authorization, immutable `productId` lookups, independently reviewed Stock V2 reservation and ledger atomicity, Stripe SDK raw-body signature verification with durable idempotency, real carrier-calculated U.S. shipping, approved server-side tax and total, release/capture/refund reconciliation, concurrency/negative tests, and explicit owner approval. No payments, shipping labels or stock migration may be activated by this safety patch.
