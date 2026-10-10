import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const text=readFileSync(new URL('../aws/stripe-v2-ledgers/template.yaml',import.meta.url),'utf8');
function block(from,to){
  const start=text.indexOf('  '+from+':');
  const finish=to==='Outputs'?text.indexOf('Outputs:',start):text.indexOf('  '+to+':',start+from.length);
  assert.ok(start>=0&&finish>start,'Expected distinct ledger resources');
  return text.slice(start,finish);
}
test('Stripe TEST ledger needs no executable SAM transform to define only DynamoDB tables',()=>{
  assert.doesNotMatch(text,/^Transform:\s*AWS::Serverless-2016-10-31/m);
  assert.doesNotMatch(text,/^Transform:/m);
  assert.match(text,/^AWSTemplateFormatVersion: '2010-09-09'/m);
});
test('Stripe TEST ledger stack cannot activate Checkout by a parameter change',()=>{
  const before=text.split('Resources:')[0];
  assert.match(before,/EnableStripeCheckout:\s*\n\s+Type: String\s*\n\s+Default: 'false'\s*\n\s+AllowedValues: \['false'\]/);
  assert.match(before,/AllowedValues: \[sandbox\]/);
  assert.doesNotMatch(text,/EnableStripeCheckout[^\n]*true/);
});
test('sandbox ledgers use separate immutable event and request identifiers',()=>{
  const event=block('StripeTestEventLedger','StripeTestCheckoutRequestLedger');
  const request=block('StripeTestCheckoutRequestLedger','Outputs');
  assert.match(event,/AttributeName: eventId, AttributeType: S/);
  assert.match(event,/AttributeName: eventId, KeyType: HASH/);
  assert.doesNotMatch(event,/AttributeName: requestId, KeyType: HASH/);
  assert.match(request,/AttributeName: requestId, AttributeType: S/);
  assert.match(request,/AttributeName: requestId, KeyType: HASH/);
  assert.doesNotMatch(request,/AttributeName: eventId, KeyType: HASH/);
  for(const section of [event,request]){
    assert.match(section,/Type: AWS::DynamoDB::Table/);
    assert.match(section,/DeletionPolicy: Retain/);
    assert.match(section,/UpdateReplacePolicy: Retain/);
    assert.match(section,/BillingMode: PAY_PER_REQUEST/);
    assert.match(section,/PointInTimeRecoveryEnabled: true/);
    assert.match(section,/SSEEnabled: true/);
    assert.doesNotMatch(section,/^\\s*TimeToLiveSpecification:/m);
    assert.doesNotMatch(section,/TableName:/);
  }
});
test('foundation deploys NO endpoint, Lambda, secret, IAM policy or stock write capability',()=>{
  for(const banned of [
    /AWS::Serverless::Function/,
    /AWS::Serverless::HttpApi/,
    /AWS::ApiGateway/,
    /AWS::Lambda/,
    /AWS::IAM/,
    /AWS::SecretsManager/,
    /dynamodb:(?:PutItem|UpdateItem|DeleteItem|TransactWriteItems)/,
    /ExistingProductsTable/,
    /ExistingInventoryTable/,
    /HOBBYHUB_STRIPE_(?:SECRET|LIVE)/,
    /hobbyhub-ProductsTable-KC31XDEOENBG/,
    /hobbyhub-InventoryTable-X2IRQDAGW7WB/
  ])assert.doesNotMatch(text,banned);
  assert.match(text,/Value: !Ref EnableStripeCheckout/);
});
