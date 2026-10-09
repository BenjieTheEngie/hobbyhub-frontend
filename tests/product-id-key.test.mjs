import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSkuMatch,tableKeyName,updateCondition} from '../backend/product-key.mjs';
import {inventoryWritesEnabled,stripeCheckoutEnabled} from '../backend/guard.mjs';

test('legacy key requires productId and does not interpret SKU as the DynamoDB key',()=>{
  assert.equal(tableKeyName({HOBBYHUB_PRODUCTS_PK_NAME:'productId'}),'productId');
  assert.equal(tableKeyName({HOBBYHUB_PRODUCTS_PK_NAME:'sku'}),'sku');
  assert.equal(tableKeyName({HOBBYHUB_PRODUCTS_PK_NAME:'id'}),null);
  assert.deepEqual(assessSkuMatch([{sku:'MTG-001',productId:'id123'}],'MTG-001','productId'),
    {status:'found',key:{productId:'id123'}});
});
test('missing SKU never gives a write key',()=>{
  assert.deepEqual(assessSkuMatch([], 'MTG-001','productId'), {status:'not_found'});
  assert.deepEqual(assessSkuMatch([{sku:'other',productId:'id1'}],'MTG-001','productId'),{status:'not_found'});
});
test('duplicate SKUs are ambiguous and cannot be changed',()=>{
  const rows=[{sku:'MTG-001',productId:'id1'},{sku:'MTG-001',productId:'id2'}];
  assert.deepEqual(assessSkuMatch(rows,'MTG-001','productId'),{status:'ambiguous'});
});
test('missing or invalid productId is not a valid write key',()=>{
  assert.deepEqual(assessSkuMatch([{sku:'MTG-001'}],'MTG-001','productId'),{status:'not_found'});
  assert.deepEqual(assessSkuMatch('not a list','MTG-001','productId'),{status:'lookup_error'});
});
test('optimistic stock condition preserves raw legacy DynamoDB data types',()=>{
  const result=updateCondition('productId',{sku:'MTG-001',quantityOnHand:'4'});
  assert.equal(result.names['#pk'],'productId');
  assert.equal(result.values[':previousStock'],'4');
  assert.match(result.condition,/#stock = :previousStock/);
});
test('optimistic stock condition handles rows with no quantityOnHand',()=>{
  const result=updateCondition('productId',{sku:'MTG-001'});
  assert.match(result.condition,/attribute_not_exists\(#stock\)/);
  assert.equal(Object.hasOwn(result.values,':previousStock'),false);
});
test('writes are off by default for sku or productId schemas',()=>{
  assert.equal(inventoryWritesEnabled({}),false);
  assert.equal(inventoryWritesEnabled({HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_PRODUCTS_PK_NAME:'productId'}),false);
  assert.equal(inventoryWritesEnabled({HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_PRODUCTS_PK_NAME:'productId',HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED:'TRUE'}),false);
});
test('legacy productId writes require both explicit gates',()=>{
  const cfg={HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_PRODUCTS_PK_NAME:'productId',HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED:'true'};
  assert.equal(inventoryWritesEnabled(cfg),true);
  assert.equal(inventoryWritesEnabled({...cfg,HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED:'false'}),false);
  assert.equal(inventoryWritesEnabled({...cfg,HOBBYHUB_INVENTORY_WRITES_ENABLED:'false'}),false);
});
test('Stripe checkout cannot run against productId-keyed legacy inventory',()=>{
  const cfg={
    HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',
    HOBBYHUB_PRODUCTS_PK_NAME:'productId',
    HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED:'true',
    HOBBYHUB_CHECKOUT_ENABLED:'true',
    HOBBYHUB_STRIPE_TEST_ONLY:'true',
  };
  assert.equal(stripeCheckoutEnabled(cfg),false);
  assert.equal(stripeCheckoutEnabled({...cfg,HOBBYHUB_PRODUCTS_PK_NAME:'sku'}),true);
});
