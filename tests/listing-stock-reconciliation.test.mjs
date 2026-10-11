import test from 'node:test';import assert from 'node:assert/strict';import {reconcileListingStock} from '../backend/listing-stock-reconciliation.mjs';
const s={productId:'listing-a',onHand:1,reserved:0,reorderPoint:0,version:1};
test('one copy reconciles without mutation',()=>assert.equal(reconcileListingStock('listing-a',s,1).reconciled,true));
test('other seller stock does not reconcile',()=>assert.equal(reconcileListingStock('listing-b',s,1).reconciled,false));
test('reserved and mismatched quantities block',()=>{assert.equal(reconcileListingStock('listing-a',{...s,reserved:1},1).reconciled,false);assert.equal(reconcileListingStock('listing-a',s,2).reconciled,false)});
