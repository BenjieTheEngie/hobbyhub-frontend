import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=(name)=>JSON.parse(readFileSync(new URL('../aws/iam/'+name,import.meta.url),'utf8'));
const preview=load('hobbyhub-checkout-v2-preview-policy.json');
const trust=load('hobbyhub-checkout-v2-exec-trust.json');
const execution=load('hobbyhub-checkout-v2-exec-policy.json');
function actions(policy){
  return policy.Statement.flatMap(s=>Array.isArray(s.Action)?s.Action:[s.Action]);
}
test('GitHub draft can only PREVIEW the Checkout V2 sandbox stack and pass its execution role',()=>{
  assert.equal(preview.Version,'2012-10-17');
  assert.equal(preview.Statement.length,2);
  const stack=preview.Statement[0];
  assert.equal(stack.Effect,'Allow');
  assert.equal(stack.Resource,'arn:aws:cloudformation:us-east-2:349744180170:stack/hobbyhub-checkout-v2-sandbox-foundation/*');
  assert.ok(stack.Action.includes('cloudformation:CreateChangeSet'));
  const pass=preview.Statement[1];
  assert.equal(pass.Action,'iam:PassRole');
  assert.equal(pass.Resource,'arn:aws:iam::349744180170:role/HobbyHubCheckoutV2SandboxCfnExec');
  assert.deepEqual(pass.Condition,{StringEquals:{'iam:PassedToService':'cloudformation.amazonaws.com'}});
  const a=actions(preview);
  for(const banned of [
    'cloudformation:ExecuteChangeSet','cloudformation:CreateStack',
    'cloudformation:UpdateStack','cloudformation:DeleteStack',
    'iam:CreateRole','iam:AttachRolePolicy','iam:PutRolePolicy'
  ])assert.ok(!a.includes(banned),'Forbidden GitHub privilege '+banned);
});
test('CloudFormation execution draft has no data-plane, IAM or production table privileges',()=>{
  assert.deepEqual(trust,{
    Version:'2012-10-17',Statement:[{Sid:'TrustCloudFormationOnly',
      Effect:'Allow',Principal:{Service:'cloudformation.amazonaws.com'},
      Action:'sts:AssumeRole'}]
  });
  assert.equal(execution.Version,'2012-10-17');
  assert.equal(execution.Statement.length,1);
  const control=execution.Statement[0];
  assert.equal(control.Effect,'Allow');
  assert.deepEqual(control.Resource,[
    'arn:aws:dynamodb:us-east-2:349744180170:table/hobbyhub-checkout-v2-sandbox-foundation-StockV2-*',
    'arn:aws:dynamodb:us-east-2:349744180170:table/hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-*'
  ]);
  assert.ok(control.Action.includes('dynamodb:CreateTable'));
  assert.ok(control.Action.includes('dynamodb:UpdateContinuousBackups'));
  for(const a of actions(execution)){
    assert.match(a,/^dynamodb:/);
    assert.ok(!a.endsWith('*'));
  }
  for(const banned of [
    'dynamodb:PutItem','dynamodb:GetItem','dynamodb:Query','dynamodb:Scan',
    'dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:DeleteTable',
    'dynamodb:TransactWriteItems','dynamodb:BatchWriteItem'
  ])assert.ok(!actions(execution).includes(banned));
});
test('neither policy grants wildcard admin actions or old production resources',()=>{
  for(const policy of [preview,execution]){
    for(const statement of policy.Statement){
      assert.equal(statement.Effect,'Allow');
      assert.notEqual(statement.Resource,'*');
      for(const action of Array.isArray(statement.Action)?statement.Action:[statement.Action])
        assert.ok(!action.includes('*'),'Wildcard IAM action '+action);
    }
  }
  const json=JSON.stringify([preview,execution,trust]);
  for(const unexpected of [
    'hobbyhub-ProductsTable-','hobbyhub-InventoryTable-',
    'hobbyhub-stripe-sandbox-ledgers-',
    'AdministratorAccess','PowerUserAccess',
    'cloudformation:ExecuteChangeSet','AWSCloudFormationFullAccess'
  ])assert.equal(json.includes(unexpected),false);
});
