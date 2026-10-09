# Hobby Hub original stock — safe read-only admin bridge

**Status: source only, AWS stack not deployed.** This is an alternative to viewing stale/missing product quantities while Stock V2 is not migrated. It does not turn on checkout or authorize stock changes.

The original, verified DynamoDB Inventory table
`hobbyhub-InventoryTable-X2IRQDAGW7WB` contains actual physical on-hand and reorder quantities under immutable `productId`; the original Products table does not have these count fields. Read-only data from the original table must **not** be treated as reserved/available-to-sell inventory for checkout.

## What the new code does

- `backend/legacy-stock-read.mjs`: admin-JWT-protected read endpoint `GET /ops/legacy-stock`; strongly consistent, fully paginated scan of four allowed Inventory attributes only, count/record validation, never returns private product records or tokens.
- `aws/legacy-stock-read/template.yaml`: isolated new SAM API and Lambda, **only** `dynamodb:Scan` on the verified original Inventory table. No `PutItem`, `UpdateItem`, `DeleteItem`, `TransactWriteItems`, Stripe, or carrier permissions.
- `src/components/LegacyStockReadPanel.jsx`: independent admin-only productId-linked stock summary/table with a manual refresh button, never edits original Inventory. Missing product stock is shown as **Unknown**, not zero. Duplicate SKU labels remain separate product records.
- `VITE_LEGACY_STOCK_READ_API_BASE_URL`: opt-in HTTPS base URL of the isolated API, not the `/ops/legacy-stock` path. Without it, existing inventory CRUD and Stock V2 controls are unchanged.

## Readiness and deploy review

The AWS account must be **349744180170**, region **us-east-2**, and verified Cognito identity pool/client the same as the existing Hobby Hub authorizer. IAM application access should use a dedicated least-privilege role, **not the root principal** currently connected through AWS Core. The existing Products and Inventory backups plus PITR have been verified.

Before deploying **new billable AWS resources** (a small Lambda/API stack), review the security configuration and approve the stack creation separately. Use AWS SAM `sam validate --lint -t aws/legacy-stock-read/template.yaml` and package/build through SAM. Deploy to staging first, then test:
- Unauthenticated GET denied, ordinary non-admin user denied.
- Admin GET returns original 7 records and total 301 units, without PII.
- POST denied and no write policies exist.
- Set the frontend environment variable only after the exact API URL is validated.
- If legacy stock changes during the test, refresh: the admin read view must show current on-hand while Stock V2 remains disabled.

**No migration, refunds, payments, product publication, inventory writes, or new AWS deployment is performed by merging this PR.**
