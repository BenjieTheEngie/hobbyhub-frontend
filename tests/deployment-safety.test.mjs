import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryWritesEnabled,stripeCheckoutEnabled} from '../backend/guard.mjs';
test('inventory writes are disabled by default',()=>{
  assert.equal(inventoryWritesEnabled({}),false);
  assert.equal(inventoryWritesEnabled({HOBBYHUB_PRODUCTS_PK_NAME:'sku'}),false);
  assert.equal(inventoryWritesEnabled({HOBBYHUB_INVENTORY_WRITES_ENABLED:'TRUE',HOBBYHUB_PRODUCTS_PK_NAME:'sku'}),false);
});
test('inventory writes require explicit approval of a single sku partition key',()=>{
  assert.equal(inventoryWritesEnabled({HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_PRODUCTS_PK_NAME:'productId'}),false);
  assert.equal(inventoryWritesEnabled({HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_PRODUCTS_PK_NAME:'sku'}),true);
});
test('retired legacy Stripe checkout stays disabled even with all former flags enabled',()=>{
  const env={HOBBYHUB_CHECKOUT_ENABLED:'true',HOBBYHUB_STRIPE_TEST_ONLY:'true'};
  assert.equal(stripeCheckoutEnabled(env),false);
  assert.equal(stripeCheckoutEnabled({...env,HOBBYHUB_PRODUCTS_PK_NAME:'sku',HOBBYHUB_INVENTORY_WRITES_ENABLED:'true'}),false);
  assert.equal(stripeCheckoutEnabled({...env,HOBBYHUB_STRIPE_TEST_ONLY:'false',HOBBYHUB_PRODUCTS_PK_NAME:'sku',HOBBYHUB_INVENTORY_WRITES_ENABLED:'true'}),false);
});
