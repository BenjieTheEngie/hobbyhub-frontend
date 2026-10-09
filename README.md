# Hobby Hub

A hobby storefront and inventory/admin platform for trading cards, tabletop games, collectibles and retro video games.

- Production website: https://hobbyhub.company
- Main branch: `main`
- Frontend: React 19 + Vite, hosted on Vercel
- Legacy backend: Amazon Cognito, API Gateway/Lambda, DynamoDB in `us-east-2`
- Experimental backend: isolated serverless Stock V2, read-only customer-order operations, and prelaunch checkout reservation model

## Current production and safety limits

The **legacy product inventory** is operational for creating, editing and removing individually identified products. Legacy `DELETE /products/{productId}` may be irreversible; review linked inventory and verified backups before removing records.

**Stock V2, new order operations and checkout are not deployed to AWS.** A successful GitHub workflow or Vercel frontend preview does not mean the new AWS functions are installed. Customer checkout is disabled; the cart is only a shopping list.

Products in legacy DynamoDB use `productId` as their partition key. `sku` is not currently guaranteed unique. Historical duplicates (including `MTG-001`) must not be deleted or merged automatically.

## Local frontend development

```bash
npm ci
npm run dev
npm run build
node --test tests/*.test.mjs
```

Admin login requires configured Cognito and the existing AWS endpoints. Browser-saved products and carts stay in local storage.

## Optional frontend environment settings

These features default disabled or disconnected:

| Setting | Function |
|---|---|
| `VITE_PUBLIC_CATALOG_URL` | Public verified catalog read endpoint, HTTPS URL |
| `VITE_INVENTORY_API_BASE_URL` | Upgraded product inventory API; do **not** set to legacy productId API |
| `VITE_STOCK_API_BASE_URL` | Isolated Stock V2 API root, not the `/stock` path |
| `VITE_ENABLE_STOCK_WRITES` | Requires literal `true`, and separate backend authorization |
| `VITE_ENABLE_STOCK_INITIALIZATION` | Requires literal `true`; separate approval for opening balances |
| `VITE_ORDER_OPS_API_BASE_URL` | Isolated read-only authenticated customer order API root |
| `VITE_CARRIER_PREVIEW_API_BASE_URL` | Optional admin-only test rate-preview API root; no label or payment capability |
| `VITE_MEDIA_API_BASE_URL` | Media and scanner add-on root |

Never put Stripe secret keys, AWS IAM credentials, Cognito client secrets, or private customer data in Vite `VITE_*` variables: these are publicly embedded at build time.

## Project documentation

- `docs/INVENTORY_V2_REBUILD.md` — legacy inventory audit, duplicate handling and migration strategy
- `docs/STOCK_V2_DEPLOYMENT.md` — isolated versioned stock tables and default-off adjustment controls
- `docs/ORDER_OPERATIONS_ROADMAP.md` — staged customer order admin with zero payment permissions
- `docs/CHECKOUT_V2_RESERVATIONS.md` — pure checkout planning, stock reservations and Stripe requirements
- `scripts/diagnose-stock-integration.sh` — read-only AWS CloudShell inspection

## Launch checklist

1. Verify backups and reconcile legacy Inventory productId references and SKU duplicates.
2. Deploy Stock V2 to staging with all write switches OFF. Validate authentication, readback, and approved opening balance migration.
3. Connect the published public catalog to verified stock and valid positive prices.
4. Implement **carrier-calculated U.S. shipping without local pickup** using verified packed dimensions, weight and destination; deploy carrier sandbox behind admin JWT, then implement server-stored quote IDs, Stock V2 reservations, signed payment webhooks, tax, refunds and fulfillment (see `docs/CARRIER_CALCULATED_SHIPPING.md`).
5. Only then review live Stripe launch, privacy/business policies, accessibility and end-to-end checkout security.

Deployments and AWS changes require the owner's approval and verification of the correct account and environment.
