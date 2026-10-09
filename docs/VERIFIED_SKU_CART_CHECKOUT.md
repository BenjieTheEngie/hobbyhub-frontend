# Public SKU cart → immutable Product IDs (server side only)

**Status: pure offline validation and tests, no deployed checkout API and no payment permissions.**

The customer browser's existing shopping-list cart uses SKU strings. Our existing Products DynamoDB table uses a `productId` primary key, not SKU, so a checkout endpoint must NEVER treat the shopper's SKU as a DynamoDB key or trust a shopper-supplied productId/price.

`backend/checkout-sku-resolver.mjs` prepares a **private server-side** checkout quote from a minimal request:

```json
{
  "requestId": "7cf18d40-0a57-4f45-af9f-fb5d478cf5a0",
  "items": [{"sku":"MTG-BOX-1","qty":1}]
}
```

The server must supply *complete* strongly-consistent Products and Stock V2 snapshots. The resolver refuses partial snapshots, ambiguous SKU labels even when one duplicate is unpublished, duplicate product IDs, malformed or orphaned stock, unavailable/unapproved products, and any item whose `onHand-reserved` is insufficient. It creates the `productId`-based intent expected by Checkout V2 and a **non-chargeable** USD quote calculated only from stored merchant prices.

Only the `publicSkuQuoteSummary` projection is suitable to return to the browser: SKU, item name, quantity, and verified cents. It does not reveal internal Product IDs, stock versions, reserve counts, cost price, AWS credentials, customer data, payment secrets, or a total falsely claimed to include shipping/tax.

## Not implemented

- No public quote Lambda or new AWS resources are deployed by this module.
- No production carrier quote endpoint, shipping tax computation, order idempotency ledger, Stripe session, verified webhook, stock reservation execution, receipt, label purchase, refund or order fulfillment write.
- The legacy Products table currently contains zero explicitly published records; **do not set `published:true` automatically**. A separate approved publication workflow is needed.
- The existing browser cart remains a non-payment shopping list.
- The resolved internal quote is not proof that the source cannot change between sequential scans. An executable checkout operation would need a deadline, transaction conditions, a unique request idempotency record and final server-side revalidation.

The goal is to reconcile legacy SKUs with immutable keys without data mutation or prematurely exposing internal Product IDs.
