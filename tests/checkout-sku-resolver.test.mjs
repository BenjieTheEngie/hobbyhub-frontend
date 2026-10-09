import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicSkuCart,resolvePublicSkuCart,publicSkuQuoteSummary} from '../backend/checkout-sku-resolver.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const products=[
 {productId:'physical-one',sku:'MTG-BOX-1',productName:'Booster box',published:true,status:'ACTIVE',salePrice:49},
 {productId:'physical-two',sku:'PKM-BOX-2',productName:'Trainer box',published:true,status:'ACTIVE',salePrice:44.95},
];
const stock=[
 {productId:'physical-one',onHand:10,reserved:2,version:4},
 {productId:'physical-two',onHand:1,reserved:0,version:7},
];
const cart={requestId,items:[{sku:'MTG-BOX-1',qty:2},{sku:'PKM-BOX-2',qty:1}]};
const snapshots=(p=products,s=stock)=>({allProducts:p,allStock:s,productsComplete:true,stockComplete:true});

test('public SKU labels resolve to immutable product IDs without trusting shopper prices',()=>{
 const result=resolvePublicSkuCart(cart,snapshots());
 assert.deepEqual(result.intent.items,[{productId:'physical-one',qty:2},{productId:'physical-two',qty:1}]);
 assert.equal(result.quote.subtotalCents,14295);
 assert.equal(result.quote.items[0].stockOnHand,10);
 assert.equal(result.quote.items[0].stockReserved,2);
 assert.equal(result.chargeable,false);
 assert.equal(result.internalOnly,true);
});
test('public quote reveals only display-safe details, never backend productId/stock versions',()=>{
 const result=resolvePublicSkuCart(cart,snapshots());
 const summary=publicSkuQuoteSummary(result);
 assert.equal(summary.totalCents,null);
 assert.equal(summary.taxCents,null);
 assert.equal(summary.paymentEnabled,false);
 assert.equal(summary.checkoutReady,false);
 assert.equal(summary.items[0].sku,'MTG-BOX-1');
 assert.equal(summary.items[0].lineTotalCents,9800);
 for(const disallowed of ['physical-one','physical-two','stockVersion','productId','reserved'])
   assert.equal(JSON.stringify(summary).includes(disallowed),false);
});
test('public request refuses client-supplied prices, product IDs, weights or shipping changes',()=>{
 assert.deepEqual(validatePublicSkuCart(cart),cart);
 for(const bad of [
  {...cart,shippingCents:1},
  {...cart,items:[{sku:'MTG-BOX-1',qty:1,priceCents:1}]},
  {...cart,items:[{sku:'MTG-BOX-1',qty:1,productId:'physical-one'}]},
  {...cart,items:[{sku:'MTG-BOX-1',qty:1,weightOz:99}]},
  {...cart,items:[{sku:'MTG-BOX-1',qty:0}]},
  {...cart,items:[{sku:'MTG-BOX-1',qty:1},{sku:'mtg-box-1',qty:1}]},
  {...cart,requestId:'unverified'}
 ])assert.throws(()=>validatePublicSkuCart(bad));
});
test('an unpublished duplicate SKU blocks even if one physical item was approved',()=>{
 const dup={...products[0],productId:'another-original',published:false};
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots([...products,dup],stock)),/ambiguous/);
});
test('missing, unpublished, archived and unverified stock must block checkout quote',()=>{
 assert.throws(()=>resolvePublicSkuCart(cart,{...snapshots(),stockComplete:false}),/Complete/);
 assert.throws(()=>resolvePublicSkuCart(cart,{...snapshots(),productsComplete:false}),/Complete/);
 const bad=[
  {...products[0],published:false},
  {...products[0],status:'DELETED'},
  {...products[0],status:'ARCHIVED'},
  {...products[0],isactive:false}
 ];
 for(const b of bad)assert.throws(()=>resolvePublicSkuCart(cart,snapshots([b,products[1]],stock)));
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots(products,[{...stock[0],reserved:9},stock[1]])),/Insufficient/);
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots(products,[{...stock[0],reserved:undefined},stock[1]])),/not configured/);
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots(products,stock.slice(0,1))),/not configured/);
});
test('server state rejects duplicate internal product IDs and incomplete unique-SKU scans',()=>{
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots([products[0],products[0]],stock)),/duplicate/);
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots(products,[stock[0],stock[0]])),/duplicate/);
 assert.throws(()=>resolvePublicSkuCart(cart,snapshots(products,[...stock,{...stock[1],productId:'unmapped'}])),/orphaned/);
});
