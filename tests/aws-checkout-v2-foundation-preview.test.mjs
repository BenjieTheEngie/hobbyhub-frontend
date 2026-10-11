import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/aws-checkout-v2-foundation-preview.yml',import.meta.url),'utf8');
test('new Checkout V2 staging workflow is opt-in, main-only, never PR or automatic',()=>{
  assert.match(workflow,/  workflow_dispatch:/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/inputs\.confirm == 'PREVIEW_NO_DEPLOY'/);
  assert.doesNotMatch(workflow,/^  push:/m);
  assert.doesNotMatch(workflow,/^  pull_request:/m);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/role-to-assume: arn:aws:iam::349744180170:role\/HobbyHubStagingDeploy/);
  assert.doesNotMatch(workflow,/allowed-account-ids:/);
  assert.match(workflow,/aws sts get-caller-identity --query Arn/);
  assert.match(workflow,/arn:aws:sts::349744180170:assumed-role\/HobbyHubStagingDeploy/);
});
test('staging workflow only proposes two standalone tables under inert locked flags',()=>{
  assert.match(workflow,/sam validate --lint --template-file "\$template"/);
  assert.match(workflow,/node --test tests\/checkout-v2-sandbox-foundation-template.test.mjs/);
  assert.match(workflow,/stack=hobbyhub-checkout-v2-sandbox-foundation/);
  assert.match(workflow,/--change-set-type CREATE/);
  assert.match(workflow,/--role-arn arn:aws:iam::349744180170:role\/HobbyHubCheckoutV2SandboxCfnExec/);
  assert.match(workflow,/ParameterKey=EnableCheckout,ParameterValue=false/);
  assert.match(workflow,/ParameterKey=EnableStockMigration,ParameterValue=false/);
  assert.match(workflow,/\['Add','OrdersV2','AWS::DynamoDB::Table'\]/);
  assert.match(workflow,/\['Add','StockV2','AWS::DynamoDB::Table'\]/);
  for(const banned of [
    /aws cloudformation execute-change-set/,
    /aws cloudformation create-stack/,
    /aws cloudformation deploy/,
    /aws cloudformation update-stack/,
    /aws dynamodb create-table/,
    /aws dynamodb put-item/,
    /aws lambda update-function-code/,
    /aws secretsmanager put-secret-value/,
    /stripe checkout/,
  ])assert.doesNotMatch(workflow,banned);
});
