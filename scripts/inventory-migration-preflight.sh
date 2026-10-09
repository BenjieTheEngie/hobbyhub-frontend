#!/usr/bin/env bash
# Hobby Hub inventory migration preflight — READ-ONLY.
# Inspects DynamoDB table schemas/backup posture and the shape of at most 10
# sample records. Does not print record values, keys, account IDs or secrets.
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-2

if ! command -v aws >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "AWS CLI and Python 3 are required. Open AWS CloudShell." >&2; exit 1
fi
echo "Hobby Hub inventory modernization — read-only preflight"
echo "Region: $AWS_DEFAULT_REGION"
echo "No records are created, deleted, updated, exported or modified."
PRODUCTS="hobbyhub-ProductsTable-KC31XDEOENBG"
INVENTORY="hobbyhub-InventoryTable-X2IRQDAGW7WB"
for TABLE in "$PRODUCTS" "$INVENTORY"; do
  echo
  echo "=== Table: $TABLE ==="
  aws dynamodb describe-table \
    --table-name "$TABLE" \
    --query 'Table.{Name:TableName,Status:TableStatus,KeySchema:KeySchema,AttributeDefinitions:AttributeDefinitions,GlobalSecondaryIndexes:GlobalSecondaryIndexes[].{Name:IndexName,KeySchema:KeySchema},StreamSpecification:StreamSpecification}' \
    --output json || continue
  echo "=== Recovery (PITR) ==="
  if ! aws dynamodb describe-continuous-backups \
      --table-name "$TABLE" \
      --query 'ContinuousBackupsDescription.{ContinuousBackupsStatus:ContinuousBackupsStatus,PITRStatus:PointInTimeRecoveryDescription.PointInTimeRecoveryStatus}' \
      --output json 2>/dev/null; then
    echo "PITR status not available; inspect backups in DynamoDB before any migration."
  fi
  echo "=== Limited sample attribute names/types (no values) ==="
  if ! aws dynamodb scan --table-name "$TABLE" --consistent-read --limit 10 --output json |
    python3 -c '
import collections,json,sys
d=json.load(sys.stdin)
items=d.get("Items",[])
print("Sampled records:",len(items))
kinds=collections.defaultdict(collections.Counter)
for row in items:
    for key,value in row.items():
        kind=next(iter(value.keys()),"unknown") if isinstance(value,dict) else "unknown"
        kinds[key][kind]+=1
for name in sorted(kinds):
    print(" ",name,":",dict(kinds[name]))
print("Note: this small sample does not establish data integrity or complete inventory relationships.")
'; then
    echo "Sample unavailable; check DynamoDB read permissions."
  fi
done
echo
echo "Next: compare Inventory-table foreign-key fields with Products.productId."
echo "Stop before writing any migration until legacy records are backed up and reviewed."
