import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../.github/workflows/aws-stripe-ledger-preview.yml',import.meta.url),'utf8');
const iam=JSON.parse(readFileSync(new URL('../aws/iam/hobbyhub-ledger-github-deploy-policy.json',import.meta.url),'utf8'));
test('ledger staging workflow is manual, gated to main and requires explicit preview confirmation',()=>{
  assert.match(source,/workflow_dispatch:/);
  assert.doesNotMatch(source,/\bpush:\s*\n|\bpull_request:/);
  assert.match(source,/github\.ref == 'refs\/heads\/main'/);
  assert.match(source,/inputs\.confirm == 'PREVIEW_NO_DEPLOY'/);
  assert.match(source,/id-token: write/);
  assert.match(source,/role-to-assume: arn:aws:iam::349744180170:role\/HobbyHubStagingDeploy/);
  assert.match(source,/allowed-account-ids: '349744180170'/);
});
test('preview may only propose exactly two immutable test-ledger tables and does not deploy',()=>{
  assert.match(source,/sam validate --lint --template-file aws\/stripe-v2-ledgers\/template.yaml/);
  assert.match(source,/--stack-name "\$stack"/);
  assert.match(source,/stack=hobbyhub-stripe-sandbox-ledgers/);
  assert.match(source,/--change-set-type CREATE/);
  assert.match(source,/--role-arn arn:aws:iam::349744180170:role\/HobbyHubStagingLedgerCfnExec/);
  assert.match(source,/ParameterKey=EnableStripeCheckout,ParameterValue=false/);
  assert.match(source,/expected=\[/);
  assert.match(source,/"StripeTestCheckoutRequestLedger"/);
  assert.match(source,/"StripeTestEventLedger"/);
  assert.doesNotMatch(source,/aws cloudformation (?:execute-change-set|deploy|delete-stack|update-stack)/);
  assert.doesNotMatch(source,/aws dynamodb (?:create-table|delete-table|put-item|update-item)/);
});
test('review-only GitHub OIDC IAM policy cannot execute CloudFormation changes',()=>{
  const actions=iam.Statement.flatMap(x=>Array.isArray(x.Action)?x.Action:[x.Action]);
  assert.ok(actions.includes('cloudformation:CreateChangeSet'));
  assert.ok(!actions.includes('cloudformation:ExecuteChangeSet'));
  assert.ok(!actions.includes('cloudformation:CreateStack'));
  assert.ok(!actions.includes('cloudformation:UpdateStack'));
  assert.ok(!actions.includes('cloudformation:DeleteStack'));
  assert.ok(actions.includes('iam:PassRole'));
});
