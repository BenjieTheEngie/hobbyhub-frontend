#!/usr/bin/env bash
# Hobby Hub SKU removal diagnostic. READ-ONLY: never calls HTTP DELETE, DynamoDB
# update/delete, CloudFormation deploy, or Lambda update methods.
set -uo pipefail
export AWS_DEFAULT_REGION="us-east-2"
API_ID="13bdy276e1"

if ! command -v aws >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "This requires AWS CLI and Python 3 (both available in AWS CloudShell)." >&2
  exit 1
fi

echo "Hobby Hub SKU removal diagnostic (read-only)"
echo "Region: $AWS_DEFAULT_REGION; API Gateway ID: $API_ID"
echo "Ensure this is the AWS account that owns hobbyhub.company backend."
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json || exit 1

API_FOUND=0
if aws apigatewayv2 get-api --api-id "$API_ID" >/dev/null 2>&1; then
  API_FOUND=1
  echo
  echo "=== HTTP API detected: /products and /products/{sku} route configuration ==="
  aws apigatewayv2 get-routes --api-id "$API_ID" --output json | python3 -c '
import json,sys
data=json.load(sys.stdin)
for r in data.get("Items", []):
    key=r.get("RouteKey","")
    if "product" in key.lower() or key=="$default":
        print("Route:",key,"| target:",r.get("Target","(none)"),"| auth:",r.get("AuthorizationType","(none)"))
'
  echo
  echo "=== HTTP API Lambda integrations (function names only) ==="
  aws apigatewayv2 get-integrations --api-id "$API_ID" --output json | python3 -c '
import json,sys,re
data=json.load(sys.stdin)
for r in data.get("Items", []):
    uri=r.get("IntegrationUri") or ""
    match=re.search(r":function:([^:/]+)",uri)
    print("Integration:",r.get("IntegrationId"),"| function:",match.group(1) if match else "(non-Lambda/unknown)","| type:",r.get("IntegrationType"))
'
elif aws apigateway get-rest-api --rest-api-id "$API_ID" >/dev/null 2>&1; then
  API_FOUND=1
  echo
  echo "=== REST API detected: product route methods ==="
  aws apigateway get-resources --rest-api-id "$API_ID" --limit 500 --output json | python3 -c '
import json,sys
data=json.load(sys.stdin)
for r in data.get("items", []):
    path=r.get("path","")
    if "product" in path.lower():
        print("Resource:",path,"| ID:",r.get("id"),"| methods:",", ".join(sorted(r.get("resourceMethods",{}))))
'
  echo
  echo "=== REST API integration details for /products/{sku} ==="
  RESOURCE_ID="$(aws apigateway get-resources --rest-api-id "$API_ID" --limit 500 --query "items[?path=='/products/{sku}'].id | [0]" --output text 2>/dev/null)"
  if [[ -z "$RESOURCE_ID" || "$RESOURCE_ID" == "None" ]]; then
    echo "No /products/{sku} resource found in this REST API."
  else
    for METHOD in GET PUT DELETE; do
      if aws apigateway get-method --rest-api-id "$API_ID" --resource-id "$RESOURCE_ID" --http-method "$METHOD" >/dev/null 2>&1; then
        echo "$METHOD route: present"
        aws apigateway get-integration --rest-api-id "$API_ID" --resource-id "$RESOURCE_ID" --http-method "$METHOD" --query '{Type:type,Uri:uri}' --output json 2>/dev/null | python3 -c '
import json,sys,re
try:
    data=json.load(sys.stdin)
    uri=data.get("Uri") or ""
    m=re.search(r":function:([^:/]+)",uri)
    print("    integration type:",data.get("Type"),"; Lambda:",m.group(1) if m else "(unknown/non-Lambda)")
except Exception:
    print("    integration details unavailable; check AWS permissions")
'
      else
        echo "$METHOD route: MISSING"
      fi
    done
  fi
else
  echo
  echo "API $API_ID was not found in us-east-2 under this account."
  echo "Confirm the AWS account/region, then check API Gateway > APIs."
fi

echo
echo "=== DynamoDB tables (names only; no data) ==="
aws dynamodb list-tables --query 'TableNames' --output json || true
echo
read -r -p "Existing Hobby Hub PRODUCTS DynamoDB table name (Enter to skip): " TABLE
if [[ -n "$TABLE" ]]; then
  echo "=== Table status/key schema; no modifications ==="
  aws dynamodb describe-table --table-name "$TABLE" --query 'Table.{Name:TableName,Status:TableStatus,KeySchema:KeySchema,AttributeDefinitions:AttributeDefinitions}' --output json || true
  echo
  echo "=== MTG-001 status (only sku, isactive, published; if key is sku:string) ==="
  TABLE_JSON="$(aws dynamodb describe-table --table-name "$TABLE" --query 'Table.{KeySchema:KeySchema,AttributeDefinitions:AttributeDefinitions}' --output json 2>/dev/null || echo '{}')"
  if printf '%s' "$TABLE_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)
keys=d.get("KeySchema") or []
attrs=d.get("AttributeDefinitions") or []
assert len(keys)==1 and keys[0].get("AttributeName")=="sku" and keys[0].get("KeyType")=="HASH"
assert any(a.get("AttributeName")=="sku" and a.get("AttributeType")=="S" for a in attrs)
'; then
    aws dynamodb get-item --table-name "$TABLE" --key '{"sku":{"S":"MTG-001"}}' --projection-expression '#s,#a,#p' --expression-attribute-names '{"#s":"sku","#a":"isactive","#p":"published"}' --consistent-read --query 'Item' --output json || true
  else
    echo "Table primary key is not exactly sku (String), so no product was queried."
  fi
fi

echo
echo "Diagnosis finished. No AWS resources were changed."
echo "Share the route/methods, integration names, and table key schema."
echo "Redact your AWS account number, ARN identifiers, and anything else private."
if [[ "$API_FOUND" -eq 0 ]]; then
  echo "First issue to resolve: the frontend points to an API in a different account/region or an API that is absent."
fi
