import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const template=readFileSync(new URL('../aws/checkout-v2-sandbox-foundation/template.yaml',import.meta.url),'utf8');
function resource(name,next){
  const start=template.indexOf('  '+name+':\n',template.indexOf('Resources:\n'));
  const end=next==='Outputs' ? template.indexOf('\nOutputs:',start):
    template.indexOf('\n  '+next+':\n',start+name.length);
  assert.ok(start>=0&&end>start,'Expected separate resources: '+name);
  return template.slice(start,end);
}
test('sandbox template cannot enable Stripe checkout, stock migration or create an API',()=>{
  assert.match(template,/^AWSTemplateFormatVersion: '2010-09-09'/m);
  assert.doesNotMatch(template,/^Transform:/m);
  for(const parameter of ['EnableCheckout','EnableStockMigration']){
    assert.match(template,new RegExp('  '+parameter+':\\n    Type: String\\n    AllowedValues: \\[\\x27false\\x27\\]\\n    Default: \\x27false\\x27'));
  }
  assert.match(template,/  Stage:\n    Type: String\n    AllowedValues: \[sandbox\]\n    Default: sandbox/);
  for(const prohibited of [
    /^\s+Type: AWS::Lambda::Function/m,
    /^\s+Type: AWS::Serverless::Function/m,
    /^\s+Type: AWS::ApiGateway/m,
    /^\s+Type: AWS::IAM::/m,
    /^\s+Type: AWS::SecretsManager::/m,
    /StripeSecretKey|StripeLive|AWS::Serverless::HttpApi|AWS::Serverless::Api/,
    /AWS::DynamoDB::GlobalTable/,
    /AWS::SQS::Queue/
  ])assert.doesNotMatch(template,prohibited);
});
test('exactly two fresh DynamoDB tables with correct order and physical product keys',()=>{
  assert.equal((template.match(/Type: AWS::DynamoDB::Table/g)||[]).length,2);
  for(const [section,key,next] of [['StockV2','productId','OrdersV2'],['OrdersV2','orderId','Outputs']]){
    const s=resource(section,next);
    assert.match(s,/Type: AWS::DynamoDB::Table/);
    assert.match(s,/DeletionPolicy: Retain/);
    assert.match(s,/UpdateReplacePolicy: Retain/);
    assert.match(s,/BillingMode: PAY_PER_REQUEST/);
    assert.match(s,/PointInTimeRecoveryEnabled: true/);
    assert.match(s,/SSEEnabled: true/);
    assert.match(s,new RegExp('AttributeName: '+key+'\\n          AttributeType: S'));
    assert.match(s,new RegExp('AttributeName: '+key+'\\n          KeyType: HASH'));
    assert.doesNotMatch(s,/^\s+TableName:/m);
    assert.doesNotMatch(s,/^\s+TimeToLiveSpecification:/m);
    assert.doesNotMatch(s,/^\s+StreamSpecification:/m);
    assert.match(s,/Key: Environment\n          Value: !Ref Stage/);
    assert.match(s,/Key: CheckoutEnabled\n          Value: !Ref EnableCheckout/);
  }
});
test('no legacy production tables, data import, write operations or scheduled migrations',()=>{
  for(const forbidden of [
    'hobbyhub-ProductsTable-KC31XDEOENBG',
    'hobbyhub-InventoryTable-X2IRQDAGW7WB',
    'dynamodb:PutItem','dynamodb:BatchWriteItem','dynamodb:TransactWriteItems',
    'dynamodb:Scan','Fn::ImportValue','AWS::DynamoDB::TableImporter',
    /^\s+TableName:/m,/^\s+DeletionPolicy: Delete/m
  ]) {
    if(typeof forbidden==='string')assert.equal(template.includes(forbidden),false,'Forbidden text: '+forbidden);
    else assert.doesNotMatch(template,forbidden);
  }
  assert.match(template,/Value: !Ref EnableStockMigration/);
  assert.match(template,/Value: !Ref StockV2/);
  assert.match(template,/Value: !Ref OrdersV2/);
});
