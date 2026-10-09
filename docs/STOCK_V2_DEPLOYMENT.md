# Hobby Hub Stock V2 — staging-first rollout

**Status: source code only. Nothing in this directory has been deployed to AWS.**

This is an isolated stock service designed to coexist with (not replace) the working legacy Hobby Hub product management in AWS us-east-2.

## Implemented

- `backend/stock-v2.mjs`: admin-only `GET /stock`, `GET /stock/{productId}`, `POST /stock/{productId}/initialize`, `POST /stock/{productId}/adjust`. Separate table keyed by immutable `productId`, with integer on-hand balances, explicit reserved units initialized to zero, reorder points, monotonically increasing record versions, and atomic DynamoDB transaction audit events keyed by UUID request ID. Never treats SKU as a DynamoDB partition key.
- `backend/stock-v2-logic.mjs`: strict input validation, idempotent request comparison, nonnegative stock constraints, verified public projection, exact case-insensitive SKU uniqueness checks.
- `backend/catalog-v2.mjs`: public read-only catalog that requires explicitly `published:true`, non-archived products, unique SKU across the complete bounded scan, valid positive price, and a separate verified positive stock balance. Does not leak product IDs, cost basis, supplier or customer fields.
- `src/lib/stockV2Client.js`: browser adapter. Refuses malformed/duplicate stock IDs. Integrates only if `VITE_STOCK_API_BASE_URL` is explicitly configured. All stock writes are followed by a fresh read and version check; no optimistic UI-only counts.
- `src/components/StockControls.jsx`: per-productId quantity adjuster, optional initial count, reason and notes, confirmation, low-stock alert.
- `aws/stock-v2/template.yaml`: a new SAM stack with two **new** DynamoDB tables (stock + audit), with deletion protections, point-in-time recovery, dedicated JWT-protected admin stock API and public read-only catalog. Does not modify the original Products or Inventory tables. **PITR and AWS infrastructure incur costs; review billing before deploying.**

### Write switches (both default OFF)

`EnableStockWrites=false` controls any stock write. `EnableStockInitialization=false` separately controls opening balances. `VITE_ENABLE_STOCK_INITIALIZATION=true` shows the initialization form in the browser but **does not grant AWS permission**.

The frontend also requires `VITE_ENABLE_STOCK_WRITES=true` before adjustment controls are enabled. This is a UI switch only: it cannot bypass the backend's `EnableStockWrites=false` guard. The frontend flag defaults OFF.\n\n**Do not enable these switches until the original InventoryTable key schema, stock fields and productId references have been inspected**. Existing legacy product rows omit `quantityOnHand`; assuming zero would destroy stock counts.

### Staging and production steps

1. In AWS CloudShell, run the already merged **read-only** scripts:

   ```bash
   cd ~/hobbyhub-frontend
   git pull --ff-only
   bash scripts/diagnose-stock-integration.sh
   bash scripts/inventory-migration-preflight.sh
   ```

2. Inspect `hobbyhub-InventoryTable-X2IRQDAGW7WB` and the existing ProductsFunction source, especially the JSON body expected by `POST /inventory/{productId}/adjust` and whether any purchase orders reference inventory rows. Reconcile each productId and opening quantity. Do not print secrets or full customer records.
3. Take verified AWS backups / enable recovery for original legacy tables (requires approval; may incur costs). Determine how to preserve the existing stock balance and purchasing history before initializing new stock.
4. If desired, deploy the *new* SAM stack into an **isolated test stage** only, after verifying the current AWS account/region and reviewing the CloudFormation change set:

   ```bash
   cd ~/hobbyhub-frontend
   sam validate --lint --template-file aws/stock-v2/template.yaml
   ```

   Review and approve any build and deploy actions separately. Do not run a production deploy or enable writes just from these instructions.

5. In a staging clone of the frontend, configure `VITE_STOCK_API_BASE_URL` with the new Stack's `StockApiUrl` (root URL, **not** `/stock`). The admin record panel will show verified stock if balances exist. Without it, current production inventory works unchanged.
6. With the stock service still write-disabled, verify JWT, admin-group access, CORS, GET stock, and that public `/catalog` returns no legacy unpublished or duplicated products.
7. Import *reconciled* opening balances through an approved, idempotent migration into the new table. Then enable initialization for manually verified stragglers and test with a disposable productId. Never bulk-initialize unknown inventory to zero.
8. Enable stock writes only after successful staging adjustments, replay tests, version conflict checks, backup tests and verifying real AWS stock. Then set `VITE_PUBLIC_CATALOG_URL` to the `PublicCatalogUrl` of the new service for an approved public storefront rollout.

### Important limits

- Existing legacy product add/edit/delete routes are **unchanged**. The new stock service does not automatically update the old `InventoryTable`; you must choose a controlled migration/cutover point. Running two active stock sources without reconciliation is dangerous.
- Checkout implementation in the previous add-on still assumes `sku` is the DynamoDB primary key and is **not** compatible with the legacy `productId` table. Keep Stripe and checkout disabled until order reservations and webhooks are refactored for Stock V2 with atomic, idempotent transactions.
- The bounded scan catalog is for small inventory; at scale, add paginated indices and a publishable projection. If the scan exceeds limits, the API fails closed, rather than listing incomplete or possibly duplicate SKUs.
- Public catalog intentionally exposes only **unreserved available units** and excludes fully reserved or unknown stock. An explicitly published product with no verified availability remains private/unavailable.
- This service uses the verified original Products table only to confirm that a productId exists during initial opening. No old products are modified or removed by the new code.

## Explicit reserved quantity invariant

The latest Stock V2 model stores `{productId,onHand,reserved,reorderPoint,version,updatedAt}`. New opening balances set `reserved:0`. The stock API and admin UI require `0 <= reserved <= onHand` and reject missing/malformed reserved fields. A normal stock adjustment uses exact version conditional checks and cannot reduce `onHand` below `reserved`. Public catalog lists `available=onHand-reserved`, not physical inventory. **No code in this phase automatically reserves/releases stock or executes a paid order**; reservation/release audit and webhook idempotency still require an approved separate release. If stock was deployed before this new schema, do NOT switch on writes or publish legacy rows without a verified one-time schema migration and full backups.
