# First-listing sandbox ledger deployment

Deployment verified 2026-10-11 UTC. CloudFormation stack `hobbyhub-first-listing-ledgers-sandbox` in AWS account `349744180170`, region `us-east-2`.

## Provisioned resources

| Purpose | DynamoDB table | Key |
|---|---|---|
| Stock V2 adjustment audit | `hobbyhub-first-listing-ledgers-sandbox-StockV2Audit-TN1UF16B0BBO` | `requestId` |
| Publication approvals | `hobbyhub-first-listing-ledgers-sandbox-PublicationApprovals-BU9JO5S2LGQD` | `productId` |

Both tables were verified ACTIVE, PAY_PER_REQUEST, SSE enabled, PITR enabled (35 days), and approximately zero items. The CloudFormation stack was CREATE_COMPLETE. Change set contained **exactly two DynamoDB table additions**; no IAM, Lambda, API, or legacy table modifications.

## Remaining integration gates

- Do not enable `HOBBYHUB_STOCK_V2_WRITES_ENABLED`, `HOBBYHUB_STOCK_V2_INIT_ENABLED`, or `HOBBYHUB_CATALOG_APPROVAL_WRITES_ENABLED` until authenticated endpoints, least-privilege roles, and audit transactions are deployed and tested.
- Do not initialize stock for `prd_9bfd1285-899c-45cb-869c-6058aff5b424` until verifying seller-reported physical count and persisted card finish/edition.
- Connect admin handlers to Stock V2, audit, Products, and approval tables only after verifying exact environment and access policies.
- Keep product publication, checkout payments, and legacy stock migration disabled.
- Tables use `Retain` deletion policy; deleting the stack would not delete the tables. Treat orphaned tables as billable resources and reconcile before cleanup.
