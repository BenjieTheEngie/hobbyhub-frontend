#!/usr/bin/env bash
# Hobby Hub legacy stock integration diagnostic — READ ONLY.
# Inspects API routes and Inventory/Products DynamoDB schemas, samples
# only attribute names/types and numeric quantity fields. Does not print
# full record IDs, account numbers, Lambda environment values or secrets.
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-2
API_ID=13bdy276e1
PRODUCTS=hobbyhub-ProductsTable-KC31XDEOENBG
INVENTORY=hobbyhub-InventoryTable-X2IRQDAGW7WB
FUNCTION=hobbyhub-ProductsFunction-BxImcqVEDKKV

command -v aws >/dev/null || { echo "AWS CLI required"; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 required"; exit 1; }
echo "=== Hobby Hub stock integration audit (READ-ONLY) ==="
echo "Region: $AWS_DEFAULT_REGION"
echo "No AWS resources or records will be changed."
echo
echo "=== Live stock-related API routes ==="
aws apigatewayv2 get-routes --api-id "$API_ID" --output json |
  python3 -c '
import json,sys
for r in json.load(sys.stdin).get("Items",[]):
    name=r.get("RouteKey","")
    if "/inventory" in name or "/products" in name:
        print(name,"| auth:",r.get("AuthorizationType","unknown"),"| target:",r.get("Target","unknown"))
' || echo "API route lookup unavailable."
echo
echo "=== Products Lambda runtime/handler only (no source or environment values) ==="
aws lambda get-function-configuration --function-name "$FUNCTION" \
  --query '{Runtime:Runtime,Handler:Handler,LastModified:LastModified}' \
  --output json || echo "Lambda metadata unavailable."
for TABLE in "$PRODUCTS" "$INVENTORY"; do
  echo
  echo "=== DynamoDB table key schema: $TABLE ==="
  aws dynamodb describe-table --table-name "$TABLE" \
    --query 'Table.{TableName:TableName,ItemCount:ItemCount,KeySchema:KeySchema,AttributeDefinitions:AttributeDefinitions,Indexes:GlobalSecondaryIndexes[].{Name:IndexName,KeySchema:KeySchema}}' \
    --output json || continue
  echo "=== Read-only attribute sample: $TABLE ==="
  aws dynamodb scan --table-name "$TABLE" --consistent-read --limit 60 --output json |
    python3 -c '
import json,sys,collections,hashlib
result=json.load(sys.stdin)
rows=result.get("Items",[])
print("Sample size:",len(rows),"(not the full table)")
attrs=collections.defaultdict(collections.Counter)
candidates=("quantityOnHand","onHand","quantity","stock","available","reserved","reorderPoint","currentStock","qty","adjustment","balance","productId","inventoryId","sku","locationId","updatedAt")
for item in rows:
    for key,value in item.items():
        if isinstance(value,dict):
            attrs[key][next(iter(value.keys()),"unknown")]+=1
        else:
            attrs[key]["unknown"]+=1
print("Attribute names and DynamoDB types:")
for key in sorted(attrs):
    print("  ",key,dict(attrs[key]))
print("First five sample record field indicators (IDs never displayed):")
for i,item in enumerate(rows[:5],1):
    sample={"sample":i}
    for key in candidates:
        entry=item.get(key)
        if not isinstance(entry,dict):continue
        if key in ("productId","inventoryId","sku","locationId"):
            value=entry.get("S",entry.get("N",""))
            sample[key+"Present"]=bool(value)
            if key=="productId" and value:
                sample["productIdHash"]=hashlib.sha256(str(value).encode()).hexdigest()[:10]
        elif key in ("updatedAt",):
            sample[key+"Present"]=True
        else:
            # Stock values are not credentials; reveal numbers only.
            if "N" in entry:sample[key]=entry["N"]
            elif "BOOL" in entry:sample[key]=entry["BOOL"]
            else:sample[key+"Type"]=next(iter(entry.keys()),"unknown")
    print(json.dumps(sample))
if result.get("LastEvaluatedKey"):
    print("Sampling stopped early. No full-table uniqueness or coverage claims.")
' || echo "Could not inspect sample. Verify read permissions."
done
echo
echo "=== Interpretation ==="
echo "Products route: GET/POST /products, PUT/DELETE /products/{productId}"
echo "Stock write route: POST /inventory/{productId}/adjust"
echo "A stock READ route is not established by this diagnostic."
echo "The exact JSON body expected by stock adjustment must be verified in the original Lambda code."
echo "Read-only inspection complete; no AWS data changed."
