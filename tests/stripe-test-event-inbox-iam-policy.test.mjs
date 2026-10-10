import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const policy=JSON.parse(readFileSync(new URL(
  '../aws/iam/hobbyhub-stripe-test-inbox-ddb-data-policy.json',import.meta.url
),'utf8'));

test('future test-only webhook ledger writer can read/write ONE physical sandbox event table',()=>{
  assert.equal(policy.Version,'2012-10-17');
  assert.equal(policy.Statement.length,1);
  const stmt=policy.Statement[0];
  assert.equal(stmt.Effect,'Allow');
  assert.deepEqual(stmt.Action,['dynamodb:GetItem','dynamodb:PutItem']);
  assert.equal(stmt.Resource,
    'arn:aws:dynamodb:us-east-2:349744180170:table/hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5');
  assert.deepEqual(stmt.Condition,{
    'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['evt_*']},
    Null:{'dynamodb:LeadingKeys':'false'}
  });
});
test('future policy grants no inventory, orders, scanning, tagging, deleting, IAM or Stripe secret reads',()=>{
  const content=JSON.stringify(policy);
  for(const banned of [
    'hobbyhub-ProductsTable-','hobbyhub-InventoryTable-',
    'hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-',
    'dynamodb:Scan','dynamodb:Query','dynamodb:UpdateItem',
    'dynamodb:TransactWriteItems','dynamodb:DeleteItem',
    'dynamodb:DeleteTable','secretsmanager:','iam:',
    'cloudformation:','lambda:'
  ])assert.equal(content.includes(banned),false,'Unexpected power '+banned);
  assert.equal(content.includes('"Resource":"*"'),false);
});
