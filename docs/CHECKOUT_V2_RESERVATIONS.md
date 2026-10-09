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
4. **Shipping/tax**: subtotal is informational. There is no verified shipping or tax quote yet, so the returned pure object deliberately has `shippingCents:null`, `taxCents:null`, `totalCents:null`, `checkoutReady:false`. Do not charge cards until real business rules are confirmed.
5. **AWS access and deployment**: original Inventory table key/relations and paid order history must be reconciled before any new stock cutover. Separate backups are required.
6. **Customer privacy**: capture shipping addresses only through the approved secure payment flow, and expose customer PII to authorized fulfillment workers on a need-to-know basis.

## Merchant input needed

- Domestic US only or international at first launch?
- Shipping carriers/services, packaging, estimated handling time and shipping charges?
- Allow local pickup?
- Returns/refunds for singles versus sealed products and used video games?
- Launch with just in-stock items and explicit unpublished state (recommended).

The present storefront remains a non-payment shopping list until all above steps are implemented and approved.

## Deployment guardrails

No new environment variables were enabled; no AWS resources, payment secrets or records were accessed or changed. Run `node --test tests/checkout-v2-core.test.mjs` to validate the pure domain model. Do not promote this file into a Lambda handler by importing it alone; an independently verified secured checkout deployment and integration suite are required.
