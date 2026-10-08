#!/usr/bin/env bash
# Hobby Hub AWS discovery. Strictly read-only: no deploy, create, update or delete operations.
set -euo pipefail
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-2}"
if ! command -v aws >/dev/null 2>&1; then
  echo 'AWS CLI is required (already provided by AWS CloudShell).' >&2; exit 1
fi
command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required.' >&2; exit 1; }
echo "Hobby Hub AWS discovery, region: ${AWS_DEFAULT_REGION}"
echo 'Read-only checks; this script does not create or modify resources.'
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
printf '\n=== CloudFormation stacks (active) ===\n'
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query 'StackSummaries[].{Name:StackName,Status:StackStatus}' --output table || true
printf '\n=== Likely Hobby Hub Lambda functions ===\n'
aws lambda list-functions --query 'Functions[].{Name:FunctionName,Runtime:Runtime}' --output json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps([r for r in d if any(x in r["Name"].lower() for x in ["hobby", "product", "inventory", "dashboard"])], indent=2))' || true
printf '\n=== DynamoDB table names (no data is read) ===\n'
aws dynamodb list-tables --query 'TableNames' --output json || true
printf '\n=== Cognito user pool names and IDs (no users are read) ===\n'
aws cognito-idp list-user-pools --max-results 50 --query 'UserPools[].{Name:Name,Id:Id}' --output table || true
printf '\n=== HTTP APIs (names and IDs only) ===\n'
aws apigatewayv2 get-apis --query 'Items[].{Name:Name,ApiId:ApiId,ProtocolType:ProtocolType}' --output table || true
printf '\n=== Existing product table key schema ===\n'
read -r -p 'Enter existing DynamoDB products table name (blank to skip): ' TABLE
if [[ -n "$TABLE" ]]; then
  aws dynamodb describe-table --table-name "$TABLE" --query 'Table.{Name:TableName,Status:TableStatus,KeySchema:KeySchema,AttributeDefinitions:AttributeDefinitions,BillingMode:BillingModeSummary.BillingMode,ItemCount:ItemCount}' --output json
  echo 'Verify EXACTLY one HASH key named sku of type S; otherwise STOP before deploying CRUD.'
fi
echo 'Done. Review and redact AWS account identifiers before sharing output. No credentials are printed.'
