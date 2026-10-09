# Hobby Hub Inventory 2.0 — rebuild specification

## Why the existing inventory should not be wiped

AWS diagnosis (2026-10-08) confirmed:
- The deployed HTTP API uses `GET/POST /products`, `PUT/DELETE /products/{productId}`, and `POST /inventory/{productId}/adjust`.
- Products DynamoDB table `hobbyhub-ProductsTable-KC31XDEOENBG` uses `productId` (String) as the primary key, not SKU.
- Inventory table `hobbyhub-InventoryTable-X2IRQDAGW7WB` is separate. Its primary key and relations have not yet been inspected.
- Ten distinct product IDs share `sku=MTG-001`, all named “Magic Booster Pack,” with prices $5.99, $0, or negative.
- Product rows shown did not contain `quantityOnHand`, `isactive`, or `published`. None of these absences should be interpreted as a verified zero stock or an explicitly unpublished item.
- Delete behavior in the original Lambda has not yet been verified; it may be irreversible.

**Preserve the current tables and records untouched until backup, reconciliation and a staged migration have been approved.**

## Phase 1 — usable now (GitHub + Vercel only)

Implemented in `src/components/InventoryWorkspace.jsx`, `ProductEditor.jsx` and `src/lib/inventoryAnalytics.js`:

- One record per true product identity (`productId`), not a deduplicated SKU list.
- Data-health and duplicate-SKU workspaces, category and full-text filters, paginated results and exact-record inspector.
- Separate indicators for unknown stock, invalid prices, zero-price placeholders and unknown publication state.
- Read-only, local CSV audit export with original record IDs, source prices and issue labels. Spreadsheet formula cells are neutralized.
- Reorganized product editor with controlled identity, prices, card variants, media, stock and publication fields.
- Legacy irreversible deletion removed from the everyday UI. Do not substitute a local “archive” flag for a verified AWS write.
- Customer checkout stays disabled.

This is a UI rebuild, **not an AWS migration**.

## Phase 2 — backend inventory domain (requires AWS verification and deployment)

Recommended canonical data model:

### Product master

`productId`: opaque immutable UUID. Every exact printing, sealed product or used video game must be its own record.

`sku`: unique business identifier with an explicit scheme and immutable after creation. Implement uniqueness through a **transactional reserved-SKU item** in a separate lookup table; DynamoDB GSIs alone do not guarantee uniqueness.

`name`, `category`, `game`, `brand`, `setCode`, `collectorNumber`, `variant`, `finish`, `condition`, `language`, `barcode`, `images`, `salePriceCents` (integer, >=0), `costCents` (optional, private), `archivedAt`, `publishedAt`, `createdAt`, `updatedAt`, `version`.

### Inventory balances and audit ledger

`productId`, `locationId`, `onHand`, `reserved`, `available`, `reorderPoint`, `version`, `updatedAt`.

Each adjustment is recorded with a transaction/ledger ID, actor, timestamp, reason, quantity delta and idempotency key. Quantity is adjusted with a conditional atomic write, never by replacing an entire product row. Purchasing, scanning, POS and order fulfillment share this controlled stock adjustment workflow. The public storefront reads a derived available-to-sell count.

### Safe write API

- `GET /inventory/products?cursor=...&query=...&status=...` — authenticated paginated list, joining product and inventory balances.
- `POST /inventory/products` — transactional unique-SKU reservation and new product creation; default unpublished.
- `PATCH /inventory/products/{productId}` — version-checked allowlisted product updates; stock excluded.
- `POST /inventory/products/{productId}/archive` — soft archive; refuse if active orders or linked inventory require review.
- `POST /inventory/products/{productId}/restore` — restore as unpublished.
- `POST /inventory/{productId}/adjust` — authenticated conditional stock write + audit event.
- `GET /catalog` — anonymous read of only verified published/unarchived products with permitted images and positive available stock (or clearly labeled out-of-stock listings).

**Do not implement the new archive flow as an unprotected hard DELETE.** Require Cognito admin JWT and scoped permissions on writes. Stripe checkout must remain disabled until inventory reservation and webhook replay safety are implemented against this canonical model.

## Phase 3 — migrating the actual AWS tables

1. Run the read-only `scripts/inventory-migration-preflight.sh` script in CloudShell. This returns Products and Inventory schemas, PITR status and sampled attribute **names/types only**.
2. Review CloudFormation stack ownership, Lambda source, API Gateway authorizers, identity references in Suppliers/PurchaseOrders and existing stock adjustments. Do not overwrite legacy stacks.
3. Create on-demand backups or enable point-in-time recovery **before** any writes. This step may incur AWS costs; obtain authorization.
4. Export/backup original records to a private controlled location, including all productId references. No secrets or bulk customer data in chat.
5. Produce a dry-run reconciliation report. For each duplicate SKU, identify which product IDs represent intentional separate products versus accidental copies. For `MTG-001`, explicitly decide which records to retain, split into unique SKUs, archive or discard after confirming purchase-order and stock dependencies.
6. Deploy an **isolated staging** inventory service and versioned, non-destructive migration job. Run two-pass validation: record counts and references before/after; stock totals reconciled separately.
7. Test CRUD/soft archive/restore, concurrent SKU creation rejection, pagination, inventory adjustments, Cognito access, publication rules and preview frontend.
8. Only then switch the production frontend inventory API and catalog URL to the new service; monitor errors. Keep the old tables in place for rollback until data integrity is confirmed.

### Rollback

Disable inventory write flags, revert Vercel environment variables and redeploy the previous frontend; retain old DynamoDB backups. Never treat deleting the old table as rollback.

## Current development boundary

No AWS stack, records, roles, API endpoints or stock balances are modified by committing this UI or running the preflight. The standalone ProductEditor still uses the existing authenticated products API for explicit saves, which must be tested against the current Lambda contract before using it for mass editing. The audit export is browser-local; it is a review sheet, **not** a guaranteed backup of DynamoDB records or inventory/PO relationships.

**Decision needed from the owner before stage-2 migration:** preserve and reconcile usable products into the new model (recommended), or start a brand-new catalog and keep all old data archived/backed up.
