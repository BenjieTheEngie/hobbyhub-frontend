import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const template=readFileSync(new URL('../aws/stock-v2/template.yaml',import.meta.url),'utf8');
const between=(begin,end)=>{
  const a=template.indexOf(begin),b=template.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,'Expected named SAM sections must exist');
  return template.slice(a,b);
};
const stock=between('  StockFunction:','  CatalogApprovalAdminFunction:');
const approval=between('  CatalogApprovalAdminFunction:','  PublicCatalogFunction:');
const publicFunction=between('  PublicCatalogFunction:','Outputs:');

test('Stock V2 flags default to OFF and IAM conditions reference exact flags',()=>{
  for(const param of ['EnableStockWrites','EnableStockInitialization','EnableCatalogApprovalWrites']){
    const start=template.indexOf('  '+param+':');
    assert.ok(start>=0,'Missing feature flag '+param);
    const portion=template.slice(start).split(/\n  [A-Za-z]\w*:|\nConditions:|\nResources:/)[0];
    assert.match(portion,/Default: 'false'/);
  }
  assert.match(template,/StockWritesActive: !Equals \[!Ref EnableStockWrites, 'true'\]/);
  assert.match(template,/StockInitActive: !And[\s\S]*?!Condition StockWritesActive[\s\S]*?!Equals \[!Ref EnableStockInitialization, 'true'\]/);
  assert.match(template,/CatalogWritesActive: !Equals \[!Ref EnableCatalogApprovalWrites, 'true'\]/);
});
test('new stock Lambda has no unconditional DynamoDB write actions',()=>{
  assert.doesNotMatch(stock,/Action: \[[^\]\n]*(?:PutItem|UpdateItem)[^\]\n]*\]/);
  assert.match(stock,/StockWritesActive[\s\S]*?\[dynamodb:UpdateItem\]/);
  assert.match(stock,/StockWritesActive[\s\S]*?\[dynamodb:PutItem\]/);
  assert.match(stock,/StockInitActive[\s\S]*?\[dynamodb:PutItem\]/);
  assert.match(stock,/\[dynamodb:GetItem, dynamodb:Scan\]/);
});
test('catalog approval writes also require a separate opt-in condition',()=>{
  assert.doesNotMatch(approval,/Action: \[[^\]\n]*PutItem[^\]\n]*\]/);
  assert.match(approval,/CatalogWritesActive[\s\S]*?\[dynamodb:PutItem\]/);
  assert.match(approval,/HOBBYHUB_CATALOG_APPROVAL_WRITES_ENABLED: !Ref EnableCatalogApprovalWrites/);
});
test('public storefront catalog is always read-only',()=>{
  assert.match(publicFunction,/Action: \[dynamodb:Scan\]/);
  assert.doesNotMatch(publicFunction,/dynamodb:(?:PutItem|UpdateItem|DeleteItem|TransactWriteItems)/);
});
