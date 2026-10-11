import test from 'node:test';
import assert from 'node:assert/strict';
import {firstListingReadiness} from '../backend/first-listing-readiness.mjs';
import {publicationFingerprint} from '../backend/publication-approvals.mjs';
const product={productId:'lightning-f5b424',sku:'MTG-SLD-IFIYW-7-F',
 productName:'Lightning Bolt',category:'Magic: The Gathering',status:'ACTIVE',
 salePrice:7.50,finish:'party-foil'};
const stock={productId:product.productId,onHand:1,reserved:0,reorderPoint:0,version:1};
const approval={productId:product.productId,approved:true,revision:1,
 approvedAt:'2026-10-10T20:00:00Z',fingerprint:publicationFingerprint(product)};
const run=(patch={})=>firstListingReadiness({product,stock,approval,
 expectedPrice:7.50,expectedQuantity:1,...patch});
test('verified one-copy approved card can pass read-only readiness checks',()=>{
 const result=run();
 assert.equal(result.ready,true);
 assert.equal(result.paymentsEnabled,false);
 assert.equal(result.quantityAvailable,1);
});
test('unapproved existing card remains blocked',()=>{
 const result=run({approval:null});
 assert.equal(result.ready,false);
 assert.equal(result.checks.find(c=>c.code==='publication-approval').ok,false);
});
test('missing stock, wrong quantity, price drift and changed fingerprint fail closed',()=>{
 for(const patch of [{stock:null},{stock:{...stock,onHand:2}},
 {product:{...product,salePrice:8}},{product:{...product,finish:'foil'}}])
 assert.equal(run(patch).ready,false);
});

test('missing, zero or invalid seller-confirmed expectations cannot pass',()=>{
 for(const patch of [{expectedQuantity:0},{expectedQuantity:undefined},{expectedPrice:undefined},{expectedPrice:7.505}])
 assert.throws(()=>run(patch),/Seller-confirmed/);
});
