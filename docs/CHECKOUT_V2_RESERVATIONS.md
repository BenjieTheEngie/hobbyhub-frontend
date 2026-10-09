# Hobby Hub Checkout V2: reservation model, not a payment integration

**Implementation status: pure offline planning functions and tests. No payment, inventory or AWS writes are performed.**

The existing `backend/checkout.mjs` assumes products are keyed by `sku`, while real legacy Products use immutable `productId` and can contain duplicate SKU labels. That implementation must **remain disabled**. `backend/checkout-v2-core.mjs` is an isolated checkout *core*, not a Lambda entrypoint or live checkout endpoint.

## Completed in this iteration

- Validates a minimal, idempotent checkout intent with immutable `productId` and integer `qty`; rejects client-supplied prices.
- Uses complete, strongly consistent product + stock snapshots and an independently verified SKU count/index to reject ambiguous legacy products.
- Requires an explicit published listing with a safe positive server-side price.
- Requires a versioned Stock V2 balance with known `onHand` and explicit `reserved` units; refuses unknown/uninitialized stock.
- Prevents negative availability, excessive quantities, and unsafe multi-decimal prices.
- Creates a *pure* DynamoDB transaction plan (stock reservation per productId with exact version/onHand/reserved guards, and a new `RESERVED` order record).
- Makes `paymentStatus='PENDING'` and `checkoutReady=false` explicit; never turns a local cart or browser redirect into payment confirmation.
- Defines a separate read-only fulfillment eligibility predicate requiring *verified* paid status and nonempty item snapshot.

## Critical unimplemented requirements

1. **Stock V2 reserved units**: before executing any plan, extend initialization to create `reserved:0`, update stock adjustments to enforce `onHand >= reserved`, and implement transactional idempotent reserve/release/capture flows. The Stock V2 stack has not been deployed. This iteration intentionally does not add stock writes.
2. **Atomic order idempotency**: checkout request ID must have a server-enforced unique reservation record; repeated requests must return an existing valid Stripe session instead of reserving again. The pure plan does not establish this yet.
3. **Signed Stripe webhooks**: validate provider signatures, associate sessions with immutable order IDs, reconcile late payments, retry/event replay, payment reversals, disputes, and releases. None of this is wired.
4. **Shipping/tax**: U.S.-only delivery, no pickup is approved. Owner chose **carrier-calculated rates**; a test-only EasyPost adapter and per-product measured packaging validation are implemented in `backend/carrier-rating-v2.mjs` / `backend/easypost-test-rates.mjs`, but no production rates or address verification exist. Tax and final charge remain `null`, and `checkoutReady:false`. Do not charge cards until real business rules and tax are confirmed.
5. **AWS access and deployment**: original Inventory table key/relations and paid order history must be reconciled before any new stock cutover. Separate backups are required.
6. **Customer privacy**: capture shipping addresses only through the approved secure payment flow, and expose customer PII to authorized fulfillment workers on a need-to-know basis.

## Merchant input needed

- **Already decided:** U.S. delivery only (50 states + DC); no local pickup, territories or international in the first version.
- **Still needed:** approved rate provider/carriers, measured shipping parcels, ship-from origin, handling time, and production quote persistence/repricing. Alaska/Hawaii must be rated by provider, not guessed.
- Returns/refunds for singles versus sealed products and used video games?
- Launch with just in-stock items and explicit unpublished state (recommended).

The present storefront remains a non-payment shopping list until all above steps are implemented and approved.

## Deployment guardrails

No new environment variables were enabled; no AWS resources, payment secrets or records were accessed or changed. Run `node --test tests/checkout-v2-core.test.mjs` to validate the pure domain model. Do not promote this file into a Lambda handler by importing it alone; an independently verified secured checkout deployment and integration suite are required.

See `docs/US_SHIPPING_AND_FULFILLMENT.md` for U.S.-only shipping and offline paid-only fulfillment guards.

The initial EasyPost sandbox is **read-only/test-mode only**, and its preview quotes are explicitly refused by the reservation planner. See `docs/CARRIER_CALCULATED_SHIPPING.md`.

Stock V2 now models `reserved:0` on new opening balances, enforces physical stock `onHand >= reserved` and shows only unreserved units in the public catalog. This is a prerequisite for transactional reservations but does **not** implement paid reservations, release on payment failure, or payment webhook reconciliation. Keep live payments off.

## Idempotent reservation and expiry — offline transaction plans

`backend/checkout-reservations-v2.mjs` now provides two **pure models**:
- `buildIdempotentReservationPlan` adds a unique checkout-request ledger in a **third independent DynamoDB table** to the existing conditional stock+order plan. It stores a stable server-verified quote digest and immutable order ID, and refuses duplicate request IDs at transaction time. Do **not** use this in production before implementing secure retrieval, replay reconciliation, and Stripe session reuse.
- `buildExpiredReservationReleasePlan` models releasing only previously held units when a **real provider-verified unpaid, expired** test checkout has been confirmed. It requires terminal Stripe **test-mode** expiry evidence, a versioned PENDING/RESERVED order past `reservedUntil`, consistent per-product reserved stock, and writes a unique audit record transactionally. A separate future worker must validate the signed provider event from Stripe, fetch current order and balances from AWS, handle races/late payments, and enforce exactly-once release. The current function does **not** verify signatures or run AWS transactions.

**Critical:** These functions return `executable:false`; they are design/test artifacts, not callable Lambda handlers, and they do not implement payment collection, webhooks, customer-facing rate sessions, refunds, delivery labels or real stock locks. No additional DynamoDB table has been deployed for the ledger. Never use a test carrier shipping quote to authorize a charge or reservation. Keep all live checkout and stock-mutation flags disabled.

An expired unpaid order is represented in the read-only operations panel as **EXPIRED / CANCELLED / Not charged**, never as PAID or a calculated purchase total.

Test locally with `node --test tests/checkout-reservations-v2.test.mjs tests/order-workbench.test.mjs`.

**Webhook decision model:** `backend/payment-webhook-review.mjs` is an offline fail-closed Stripe test-event evaluator only. It checks session/order/amount identities, durable replay fingerprints and late-event disposition, but can never mark an order paid, capture stock or accept money. See `docs/PAYMENT_WEBHOOK_RECONCILIATION.md`.
