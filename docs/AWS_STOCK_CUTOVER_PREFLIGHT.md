# Hobby Hub — AWS-verified stock migration preflight (READ-ONLY)

**Do not use this as a production migration script.** This is a safety gate that reads the *existing* original Products/Inventory tables, verifies AWS account/region, backups and PITR, checks completeness and stable values, and produces a review summary. It never writes DynamoDB, initializes new balances, publishes products, enables checkout, or performs Stripe requests.

## Verified existing AWS environment (2026-10-09)

- Region: **us-east-2**; account: **349744180170**.
- Products `hobbyhub-ProductsTable-KC31XDEOENBG` has `productId` string primary key.
- Inventory `hobbyhub-InventoryTable-X2IRQDAGW7WB` also uses `productId` as its string primary key, with integer `quantityOnHand`, `reorderPoint`, and `updatedAt`.
- Verified seven Products and seven matching Inventory records, with **301 units total** and no current duplicate SKU groups.
- Every legacy Product had `status: ACTIVE` but **lacked the `published` field**. This does NOT authorize storefront publication; all listings remain gated until explicitly reviewed.
- Both legacy tables now have a verified on-demand backup and point-in-time recovery enabled. **Never infer that an existing backup covers edits made afterward.**
- The original authenticated API `13bdy276e1` contains `POST /inventory/{productId}/adjust` but no separate GET inventory route. Legacy stock writes may continue to change counts while V2 is staged.
- Current Cognito pool **us-east-2_5QRb2tWcT** and client **9qrtgdn5dtoqhc3brmr03mgn0** are known, but verify security scope before any new resources.
- AWS Core was connected as the **account root principal** during the read-only inspection. Prefer a least-privilege role for deployment.

## Run in AWS CloudShell

```bash
cd ~/hobbyhub-frontend
git pull --ff-only
node scripts/stock-cutover-preflight.mjs
```

Requires AWS CLI (already present in CloudShell) and Node.js 20+; if Node.js is not available, continue with the existing shell diagnostics or use a supported environment. **Do not copy/paste raw customer records, secrets or full account credentials.**

The script uses ONLY:
`sts GetCallerIdentity`,
`dynamodb DescribeTable`,
`DescribeContinuousBackups`,
`ListBackups`, and
`Scan` (strongly consistent, complete manual pagination).
It aborts on unknown IDs, incomplete data, orphaned foreign keys, invalid quantities, non-ACTIVE products, duplicated SKU groups, missing verified backup/PITR, or inventory drift between two full reads. It reports a digest, counts and totals without product IDs.

**Important:** Two sequential scans do not provide an atomic cross-table snapshot and cannot prevent writes occurring *after* the scan. Before any approved data migration, freeze legacy inventory writes briefly, take an immediately current snapshot, and verify counts/IDs/digests again. A hash is a drift detector, not migration permission.

## Migration design that is not yet authorized

The in-memory review computes candidate opening rows `{productId,onHand,reserved:0,reorderPoint,version:1,published:false}`. These are for assessment, not AWS writes. The new isolated Stock V2 must be provisioned and tested with all write switches OFF. A later idempotent migration executor must ensure every source record is still unchanged, create new V2 records without mutating originals, audit every operation, and use conditional writes that never overwrite an initialized destination.

Do not enable a second active stock source or public checkout until the original legacy adjust route is safely retired/reconciled and payment reservation/release is fully implemented and tested. Existing supplier POs remain separate.

## Read-only test

```bash
node --test tests/stock-cutover-review.test.mjs
```

Code lives in `backend/stock-cutover-review.mjs` (pure) and `scripts/stock-cutover-preflight.mjs` (AWS CLI read-only).
