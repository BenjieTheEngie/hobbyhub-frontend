import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicationFingerprint,approvalForProduct,verifiedPublicationApprovals,
  applyPublicationApprovals,publicationReadiness
} from '../backend/publication-approvals.mjs';
import {joinedPublicCatalog,stockBalance} from '../backend/stock-v2-logic.mjs';

const products=[
  {productId:'physical-one',sku:'MTG-ONE',productName:'Sealed Card Pack',
   status:'ACTIVE',category:'Magic: The Gathering',salePrice:6.99},
  {productId:'physical-two',sku:'GAME-ONE',productName:'Vintage Game',
   status:'ACTIVE',category:'Video Games',salePrice:35.00},
];
const approval=(p)=>({productId:p.productId,approved:true,revision:1,
  fingerprint:publicationFingerprint(p),approvedAt:'2026-10-09T18:00:00Z'});
const stock=(id,onHand)=>stockBalance({productId:id,onHand,reserved:0,reorderPoint:0,version:1});

test('original ACTIVE status alone never authorizes storefront publication',()=>{
  assert.deepEqual(applyPublicationApprovals(products,[]).map(p=>p.published),[false,false]);
  assert.deepEqual(joinedPublicCatalog(applyPublicationApprovals(products,[]),
    [stock('physical-one',10),stock('physical-two',1)]),[]);
});
test('manually approved exact product fingerprints allow only verified stock products',()=>{
  const approved=applyPublicationApprovals(products,[approval(products[0])]);
  assert.deepEqual(approved.map(p=>p.published),[true,false]);
  const catalog=joinedPublicCatalog(approved,[stock('physical-one',10),stock('physical-two',1)]);
  assert.deepEqual(catalog.map(p=>p.sku),['MTG-ONE']);
  assert.equal(catalog[0].quantityOnHand,10);
  assert.equal('productId' in catalog[0],false);
  assert.deepEqual(publicationReadiness(products,[approval(products[0])]),{
    total:2,approved:1,unapproved:1,paymentsEnabled:false,publishingIsManual:true
  });
});
test('approval becomes invalid after edits to price, SKU, image, name or category',()=>{
  const saved=approval(products[0]);
  for(const changed of [
    {...products[0],salePrice:7},
    {...products[0],sku:'MTG-TWO'},
    {...products[0],productName:'Different printing'},
    {...products[0],imageUrl:'https://example.test/new.jpg'},
    {...products[0],category:'Accessories'},
    {...products[0],status:'INACTIVE'},
  ])assert.equal(approvalForProduct(changed,saved),false);
});
test('a previous published flag in legacy Product is never sufficient without separate approval',()=>{
  assert.equal(applyPublicationApprovals([{...products[0],published:true}],[])[0].published,false);
  assert.equal(applyPublicationApprovals([{...products[0],published:true}],[approval(products[0])])[0].published,true);
});
test('duplicate SKUs across hidden legacy rows still quarantine every copy',()=>{
  const clone={...products[1],sku:'mtg-one'};
  const displayed=joinedPublicCatalog(
    applyPublicationApprovals([products[0],clone],[approval(products[0])]),
    [stock('physical-one',10),stock('physical-two',3)]
  );
  assert.deepEqual(displayed,[]);
});
test('orphan approvals, missing IDs, malformed metadata and duplicate approvals fail closed',()=>{
  assert.throws(()=>applyPublicationApprovals(products,[{...approval(products[0]),productId:'orphan'}]),/orphaned/);
  assert.throws(()=>applyPublicationApprovals([...products,products[0]],[]),/duplicate or invalid/);
  assert.throws(()=>verifiedPublicationApprovals([approval(products[0]),approval(products[0])]),/duplicate/);
  assert.throws(()=>verifiedPublicationApprovals([{...approval(products[0]),fingerprint:'wrong'}]),/invalid/);
  assert.throws(()=>verifiedPublicationApprovals([{...approval(products[0]),approved:'true'}]),/explicitly/);
  assert.throws(()=>publicationFingerprint({...products[0],salePrice:6.999}),/exact cents/);
  assert.throws(()=>publicationFingerprint({...products[0],imageUrl:'javascript:alert(1)'}),/HTTPS/);
  assert.throws(()=>publicationFingerprint({...products[0],status:'DRAFT'}),/active/);
});
test('revocations and unknown approvals never publish a product',()=>{
  assert.equal(approvalForProduct(products[0],{...approval(products[0]),approved:false}),false);
  assert.deepEqual(applyPublicationApprovals(products,[{productId:'physical-one',approved:false,revision:2}]).map(x=>x.published),[false,false]);
  assert.equal(approvalForProduct(products[0],undefined),false);
});
