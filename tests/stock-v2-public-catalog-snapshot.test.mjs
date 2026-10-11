import test from 'node:test';
import assert from 'node:assert/strict';
import {joinedPublicCatalog} from '../backend/stock-v2-logic.mjs';

const product={productId:'card-1',sku:'mtg-1',productName:'Test card',salePrice:2.50,status:'ACTIVE',published:true};
const stock={productId:'card-1',onHand:2,reserved:0,reorderPoint:0,version:1};

test('public catalog accepts a complete, valid stock snapshot',()=>{
  assert.equal(joinedPublicCatalog([product],[stock]).length,1);
});

test('public catalog refuses duplicate stock identity rather than picking a balance',()=>{
  assert.throws(()=>joinedPublicCatalog([product],[stock,{...stock,onHand:20}]),/duplicate product IDs/);
});

test('public catalog refuses malformed or incomplete stock snapshots',()=>{
  assert.throws(()=>joinedPublicCatalog([product],null),/complete list/);
  assert.throws(()=>joinedPublicCatalog([product],[{...stock,reserved:3}]),/invalid reserved/);
  assert.throws(()=>joinedPublicCatalog(null,[stock]),/Complete product snapshot/);
});
