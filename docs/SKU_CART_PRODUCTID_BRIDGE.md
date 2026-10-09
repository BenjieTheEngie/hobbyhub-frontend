# Hobby Hub SKU cart to physical productId — server-only bridge

**Offline source and tests only. No active checkout handler, Stripe payments, stock mutations or product publication.**

The existing public storefront, saved items and cart identify items by SKU. The legacy DynamoDB Products and Inventory tables instead use immutable `productId`, and historical SKU duplication may occur. We must not treat a shopper's SKU as an AWS partition key.

`backend/cart-sku-resolver-v2.mjs` provides a strict boundary for a future checkout API:

1. Require a complete, bounded/fully paginated and consistently read Products snapshot. Incomplete or invalid productId/SKU rows fail the request.
2. Detect case-insensitive duplicate SKU groups across **all records, including archived and unpublished**. Refuse ambiguous cart entries rather than choosing one.
3. Match a cart SKU to exactly one explicit `published:true`, non-archived and `status: ACTIVE` product. Never blindly publish or activate any record.
4. Reject client-provided prices, shipping sizes, quantities on hand, tokens, productId overrides and unexpected line fields. Accept only `{sku,qty}` and a UUID request idempotency key.
5. Resolve to immutable `{productId,qty}` lines. The full authoritative checkout model `verifyCheckoutQuote` must subsequently recheck publication, uniquely indexed SKU, exact server-side prices and reserved Stock V2 counts before any quote.
6. All results explicitly set `checkoutReady:false` and `paymentAuthorized:false`.

`publicCartSkuRequest` converts the current browser shopping list into a **non-executing** minimal request object for future implementation. It never calls an endpoint and strips any client subtotal/pricing/stock fields.

The mapping is a safety bridge, **not** a payment authorization, stock reservation, or public customer ID. The actual future checkout API will need additional provider-rate, tax, security, atomic idempotency, reservation/release and signed webhook requirements. See `docs/CHECKOUT_V2_RESERVATIONS.md` and `docs/PAYMENT_WEBHOOK_RECONCILIATION.md`.
