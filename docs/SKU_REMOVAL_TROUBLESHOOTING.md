# Hobby Hub: fixing Remove SKU in the deployed store

## Confirmed symptom (October 8, 2026)

The Admin Dashboard reported **"SKU MTG-001 was NOT removed: The API returned success but the SKU remains active"** and **"The new inventory API URL is not configured"**. Active inventory still had 16 products and no archived products.

This is not resolved by hiding the SKU in React. The frontend is currently falling back to its older API endpoint, `https://13bdy276e1.execute-api.us-east-2.amazonaws.com`. The new backend's `DELETE /products/{sku}` archives by setting `isactive=false` and `published=false` in DynamoDB. That code exists in `backend/inventory.mjs`, but a GitHub/Vercel deployment does **not** deploy AWS Lambda, API Gateway, or DynamoDB resources.

## First task: identify the existing API and database (no changes)

Open [AWS CloudShell in us-east-2](https://console.aws.amazon.com/cloudshell/home?region=us-east-2) **in the AWS account hosting Hobby Hub**, then run:

```bash
git clone https://github.com/BenjieTheEngie/hobbyhub-frontend.git
cd hobbyhub-frontend
bash scripts/diagnose-sku-removal.sh
```

If the repository already exists, run `git pull --ff-only` instead of cloning again.

The diagnostic reads API Gateway route definitions and their Lambda integration *names*, lists DynamoDB tables, and optionally checks the key schema and `MTG-001`'s `isactive`/`published` status. **It does not issue DELETE, update a table, or deploy anything.** It does not retrieve secrets or full product records.

Copy the results to ChatGPT after redacting AWS account identifiers. Do not share AWS access keys, Cognito passwords, Stripe secrets, or unredacted Lambda environment variables.

## What must be true before SKU removal will persist

1. **Existing table verified.** Confirm the actual products table name, region and key schema. The provided add-on assumes exactly one DynamoDB partition key named `sku`, type String. If the existing table differs, adapt the handler instead of deploying as-is.
2. **Authenticated inventory API deployed.** After verifying the existing AWS setup, deploy the add-on stack at `aws/media-addon/template.yaml` using the correct table and Cognito parameters. Verify `DELETE /products/{sku}` reaches `backend/inventory.mjs`. Do not overwrite the old API until you know which Lambda owns each route.
3. **Writes deliberately enabled.** The new backend defaults to `EnableInventoryWrites=false` and `HOBBYHUB_INVENTORY_WRITES_ENABLED=false`. After validating the table schema and admin authorization, explicitly opt into inventory writes. Do not enable Stripe checkout at the same time; leave `EnableCheckout=false`.
4. **Admin authorization confirmed.** The new API requires a valid Cognito token with membership in the configured admin group or an explicit approved subject allowlist; a successful frontend login alone does not establish API write permission.
5. **Frontend points to the new API.** In the Vercel `hobbyhub-frontend` project, set `VITE_INVENTORY_API_BASE_URL` to the actual `AddonApiBaseUrl` stack output. Set `VITE_PUBLIC_CATALOG_URL` to the actual `PublicCatalogUrl` only after validating publication behavior, and `VITE_MEDIA_API_BASE_URL` if media is deployed. Redeploy Vercel so Vite embeds the environment changes.
6. **Validate in stages.** Create a harmless test SKU, confirm it appears in Active SKUs, remove it, refresh and see it in View archived, then restore it. Verify its DynamoDB status and that the public catalog excludes it while archived.

If a DELETE request returns a successful HTTP status but the record is still active, investigate the old Lambda's actual behavior. **Do not claim the item is removed** without checking a subsequent GET or DynamoDB status.

### Security and rollback

Keep the inventory-write switch off until the table and admin policy are verified. Retain DynamoDB backups/point-in-time recovery where appropriate. Avoid permanent deletion of SKU rows that may be referenced by supplier data, orders, or purchase orders. The new implementation deliberately uses an archive state instead.

If a deployment fails verification, disable inventory writes again and roll the frontend's inventory API URL back to the previous value. Do not expose `DELETE` to unauthenticated clients.
