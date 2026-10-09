# Hobby Hub legacy productId inventory compatibility

## Verified source
AWS CloudShell, 2026-10-08: `hobbyhub-ProductsTable-KC31XDEOENBG` is ACTIVE in us-east-2 and its DynamoDB HASH key is **`productId` (String)**, not `sku`. The previous SAM add-on assumed `sku` and its CRUD methods could not address the legacy table correctly.

This is a source-code compatibility patch. **It has not been deployed to AWS.** Updating GitHub/Vercel does not deploy Lambda or API Gateway.

## Compatibility patch

- `backend/inventory.mjs`: resolves a request's exact `sku` attribute to a unique legacy `productId` using a strongly consistent, bounded DynamoDB scan. Conflicting duplicate SKUs or incomplete scans fail without mutation. Uses the resolved partition key for a conditional update/archive, preserving original productId and procurement metadata.
- `backend/product-key.mjs`: pure key-resolution/optimistic-condition helpers.
- `backend/guard.mjs`: default-off write gate. Legacy productId writes require **both** `HOBBYHUB_INVENTORY_WRITES_ENABLED=true` and `HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED=true`. Stripe checkout is **always disabled** with the productId key until a separate checkout reservation migration is complete.
- `aws/media-addon/template.yaml`: configurable `ExistingProductsPrimaryKey`, opt-in `ApproveLegacyProductIdSchema`, and corrected `dynamodb:UpdateItem` IAM policy (no destructive DynamoDB DeleteItem required).
- **New product creation is deliberately not supported on the legacy productId add-on** until the original ID generator and SKU uniqueness constraints are verified. Without a secondary uniqueness mechanism, scanning before inserting can create duplicate SKUs under concurrent requests. Existing product editing and soft-archiving are the focus.

## Required read-only checks BEFORE deployment or enabling writes

In AWS CloudShell in **us-east-2**, with the repository already cloned:

```bash
cd ~/hobbyhub-frontend
git pull --ff-only
bash scripts/diagnose-sku-removal.sh
```

Enter the verified products table name when prompted: `hobbyhub-ProductsTable-KC31XDEOENBG`.

The diagnostic now recognizes the legacy `productId` schema and performs a bounded, read-only SKU-attribute lookup. It reports the match count and boolean flags for `MTG-001` without printing raw product IDs. Also review the **API Gateway product routes and integrations** output earlier in the script.

We need to verify:
1. `MTG-001` has an actual `sku` String attribute in its DynamoDB record, and the exact SKU lookup finds exactly one `productId`.
2. Other products also have unique SKU attributes. If duplicates exist, STOP. This compatibility code refuses ambiguous matches but does not repair duplicate data.
3. API Gateway's deployed `DELETE /products/{sku}` route exists and is connected to the expected authorized Lambda.
4. The current Cognito app JWT is accepted and the administrator is assigned to the configured admin group/approved subject.
5. The existing SAM infrastructure and stack ownership are known; deploy an isolated add-on only after reviewing changes. **Do not overwrite old CloudFormation stacks or existing product Lambdas blindly.**
6. An inventory backup / PITR strategy is available.

## Deployment configuration — only after verification

In a *reviewed* SAM deployment, set:
- `ExistingProductsTable=hobbyhub-ProductsTable-KC31XDEOENBG`
- `ExistingProductsPrimaryKey=productId`
- `ApproveLegacyProductIdSchema=false` initially
- `EnableInventoryWrites=false` initially
- `EnableCheckout=false` at all times with the legacy schema
- Correct existing Cognito User Pool ID and App Client ID, along with approved admin group.

Validate the read-only inventory API first. Then test with a disposable SKU created through the **existing validated product-creation workflow**, verify a unique SKU attribute, and explicitly approve the write gates. Archive it, reload inventory, confirm `isactive:false` and `published:false` in DynamoDB, then restore it (unpublished). Do not test with `MTG-001` until the staging flow succeeds.

Only after both backend and browser CORS/auth tests work should `VITE_INVENTORY_API_BASE_URL` be set to the new AddonApiBaseUrl in Vercel, followed by a production redeployment.

## Known limits

- A strongly consistent scan is suitable only for a **small** legacy table. The lookup is bounded and fails closed for a larger table. Create a SKU GSI/lookup approach before scaling, and verify uniqueness separately.
- The existing checkout code still assumes `sku` is the partition key. It must be adapted transactionally before any orders can be accepted.
- A Lambda GET endpoint with admin JWT and read permissions can be tested with write gates off; other AWS service costs must be reviewed before deployment.
- If `sku` is absent from the current records, the lookup will safely return Not Found. Inspect the real record schema before writing a new mapping strategy.
