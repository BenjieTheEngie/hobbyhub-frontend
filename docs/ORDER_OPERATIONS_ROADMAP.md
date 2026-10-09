# Hobby Hub customer order operations — safe staging blueprint

**Source-ready, not deployed to AWS. Checkout/payment processing remains OFF.**

## Purpose

This work prepares a read-only customer order dashboard without touching supplier Purchase Orders, legacy Products, legacy Inventory, or existing payment systems. The standalone `aws/order-ops/template.yaml` provisions an empty retained DynamoDB `CustomerOrdersV2` table (primary key `orderId`), a JWT-protected read-only API, and one Lambda with DynamoDB Scan permission only.

The dashboard in `src/components/OrderWorkbench.jsx` is bundled with the admin site but remains unconnected until you deliberately set `VITE_ORDER_OPS_API_BASE_URL` to the approved root API address. When disconnected it shows an honest preparation state, no invented orders, no payment totals and no fake shipments. If connected, it displays read-only payment/fulfillment states, counts, filters and item summaries.

### Strict separation of duties

- **Stripe is the only payment authority.** The admin frontend never creates paid/refunded states or marks financial transactions completed.
- **Stock V2 is the only stock authority.** This read-only order dashboard never decrements quantities or reserves items.
- **Customer Orders V2** is the intended future record of payments, order item snapshots, fulfillment progress and payment event IDs. Only a *future* signed Stripe webhook/reservation service may create and modify these records.
- **Supplier Purchase Orders** are separate purchasing data and must not be mixed into customer sales reporting.
- **Privacy:** The admin list API deliberately omits customer email, shipping address, and unrelated personal data. Future shipping details will require an explicitly authorized separate action.

### Future order lifecycle (not yet implemented)

1. Browser submits productId and quantity to a dedicated server-side checkout operation with an idempotency token; client prices are ignored.
2. Backend rereads actual product, publication, positive stock, SKU-uniqueness, and price. Atomically reserves Stock V2 units and saves a `PENDING` order with an expiry/reconciliation key.
3. Stripe test-mode session is created and associated with the order. A signed webhook idempotently verifies success or failure. No paid status is inferred from a return URL.
4. Payment success records `PAID`; failed/expired sessions release reservations exactly once, without overselling. Late successes must be reconciled/refunded by a controlled handler.
5. Fulfillment is authorized only for verified paid orders. Prepare items, packaging, carrier/tracking, refunds and cancellations with audited server-side actions.
6. Only after exhaustive staging tests, verified backups, reconciliation, business settings and owner approval should live Stripe credentials and payment collection be considered.

### Pre-deployment requirements

- User approval for new AWS resources and possible costs (DynamoDB pay-per-request and PITR, API Gateway and Lambda).
- Confirm the actual Cognito user pool and client ID in the right AWS account/region.
- Validate the SAM template and review the CloudFormation change set before any deploy.
- Do not set the order API Vercel environment variable until staged API read permissions and CORS are tested.
- **Confirmed:** U.S.-only shipping to 50 states and DC, without local pickup. Exclude territories and military mail until specifically approved. Choose shipping origin, carrier rating provider/services, measured packed weights/dimensions including Alaska/Hawaii, handling time, returns and refund policies **before enabling paid shipment operations**.
- Do not describe the dashboard as an operating order-management service until a signed, audited checkout-and-webhook service is online.

This commit does **not** deploy resources, change any AWS records, or enable charges.

The pure fulfillment lifecycle and locked shipping policy are documented in `docs/US_SHIPPING_AND_FULFILLMENT.md`. They are not an active shipment API.

The selected pricing approach is **carrier-calculated**. The optional admin-only EasyPost test-rate preview is outlined in `docs/CARRIER_CALCULATED_SHIPPING.md`; it does not buy labels or authorize checkout.
