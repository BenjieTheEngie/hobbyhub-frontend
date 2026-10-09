import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedCatalog,shopFilter,safeSavedWishlist,toggleSavedProduct,reconcileCart} from '../src/lib/shop.js';

const live=[
  {sku:'MTG-SINGLE-1',productName:'Single One',category:'Magic: The Gathering',salePrice:4,quantityOnHand:2,published:true,createdAt:'2026-10-01'},
  {sku:'PKM-BOX-1',productName:'Trainer Box',category:'Pokémon',salePrice:40,quantityOnHand:0,published:true,createdAt:'2026-10-08'},
  {sku:'GAME-1',productName:'Retro Game',category:'Video Games',salePrice:30,quantityOnHand:1,published:true,createdAt:'2026-09-18'},
];

test('public catalog fails closed when missing publication flag or unknown inventory',()=>{
  const parsed=publishedCatalog({items:[...live,
    {sku:'MTG-DRAFT',productName:'Unverified',category:'Magic: The Gathering',salePrice:6,quantityOnHand:5},
    {sku:'PKM-UNKNOWN',productName:'No qty',category:'Pokémon',salePrice:12,published:true},
    {sku:'GAME-ZERO',productName:'No price',salePrice:0,quantityOnHand:3,published:true},
    {sku:'GAME-NEG',productName:'Invalid price',salePrice:-1,quantityOnHand:3,published:true},
    {sku:'NOT-WHOLE',productName:'Noninteger qty',salePrice:5,quantityOnHand:1.5,published:true},
  ]});
  assert.deepEqual(parsed.map(p=>p.sku),live.map(p=>p.sku));
  assert.equal(parsed.find(p=>p.sku==='PKM-BOX-1').quantityOnHand,0);
});

test('duplicate SKU is excluded even when only one copy is marked published',()=>{
  const rows=[
    ...live,
    {sku:'MTG-SINGLE-1',productName:'Different hidden duplicate',quantityOnHand:0,salePrice:4,published:false},
    {sku:'game-1',productName:'Other legacy record',quantityOnHand:4,salePrice:30,published:true}
  ];
  assert.deepEqual(publishedCatalog(rows).map(p=>p.sku),['PKM-BOX-1']);
});

test('filtered inventory supports saved-only, available-only, category and latest',()=>{
  const products=publishedCatalog(live);
  assert.deepEqual(shopFilter(products,{savedSkus:['MTG-SINGLE-1','PKM-BOX-1'],savedOnly:true}).map(p=>p.sku),
    ['MTG-SINGLE-1','PKM-BOX-1']);
  assert.deepEqual(shopFilter(products,{availability:'in-stock'}).map(p=>p.sku),
    ['MTG-SINGLE-1','GAME-1']);
  assert.deepEqual(shopFilter(products,{sort:'new'}).map(p=>p.sku),
    ['PKM-BOX-1','MTG-SINGLE-1','GAME-1']);
  assert.deepEqual(shopFilter(products,{search:'retro',category:'Video Games'}).map(p=>p.sku),['GAME-1']);
});

test('saved products are browser-local, deduplicated, bounded and resistant to invalid strings',()=>{
  assert.deepEqual(safeSavedWishlist('not json'),[]);
  assert.deepEqual(safeSavedWishlist('{"id":5}'),[]);
  assert.deepEqual(safeSavedWishlist(JSON.stringify(['MTG-SINGLE-1','MTG-SINGLE-1','!bad','PKM-BOX-1'])),
    ['MTG-SINGLE-1','PKM-BOX-1']);
  assert.deepEqual(toggleSavedProduct(['MTG-SINGLE-1'],'MTG-SINGLE-1'),[]);
  assert.deepEqual(toggleSavedProduct([],'PKM-BOX-1'),['PKM-BOX-1']);
  assert.deepEqual(toggleSavedProduct(['PKM-BOX-1'],'bad sku'),['PKM-BOX-1']);
});

test('saved products do not reserve stock or alter order quantities',()=>{
  const rows=publishedCatalog(live);
  const cart=[{sku:'MTG-SINGLE-1',cartQuantity:2}];
  const saved=toggleSavedProduct([],'MTG-SINGLE-1');
  assert.deepEqual(saved,['MTG-SINGLE-1']);
  assert.equal(reconcileCart(cart,rows)[0].cartQuantity,2);
  assert.deepEqual(cart,[{sku:'MTG-SINGLE-1',cartQuantity:2}]);
});
