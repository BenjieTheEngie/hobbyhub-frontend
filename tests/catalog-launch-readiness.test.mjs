import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogLaunchReview} from '../src/lib/catalogLaunchReadiness.js';

const product={
  productId:'p-1',sku:'MTG-001',productName:'Trading Card',status:'ACTIVE',
  isactive:true,published:true,publicationKnown:true,
  salePrice:5.99,rawSalePrice:5.99,
  stockReported:true,stockSource:'stock-v2',quantityOnHand:5,stockReserved:2,stockAvailable:3,stockVersion:2,
  shippingPackage:{lengthIn:8,widthIn:5,heightIn:1,weightOz:2}
};
test('a complete verified record passes product-data checks but never enables real payments',()=>{
  const {rows,summary}=catalogLaunchReview([product]);
  assert.equal(rows[0].catalogCandidate,true);
  assert.equal(rows[0].carrierCheckoutCandidate,true);
  assert.deepEqual(rows[0].blockers,[]);
  assert.equal(rows[0].paymentReady,false);
  assert.equal(summary.paymentReady,false);
  assert.equal(summary.catalogCandidates,1);
});
test('real legacy products do not auto-publish or infer Stock V2 from active status',()=>{
  const legacy={productId:'p-1',sku:'MTG-001',productName:'Card',status:'ACTIVE',salePrice:5.99,
    published:false,publicationKnown:false,quantityOnHand:50,stockReported:false,stockSource:'uninitialized'};
  const {rows,summary}=catalogLaunchReview([legacy]);
  assert.equal(rows[0].catalogCandidate,false);
  assert.equal(rows[0].carrierCheckoutCandidate,false);
  assert.ok(rows[0].blockers.includes('unapproved-publication'));
  assert.ok(rows[0].blockers.includes('unknown-stock'));
  assert.ok(rows[0].blockers.includes('unmeasured-package'));
  assert.equal(summary.unapproved,1);
});
test('SKU duplicates across case and different productId block every copy',()=>{
  const first={...product};
  const second={...product,productId:'p-2',sku:'mtg-001'};
  const {rows,summary}=catalogLaunchReview([first,second]);
  assert.equal(summary.duplicateSkuGroups,1);
  assert.equal(rows.every(r=>r.blockers.includes('duplicate-sku')&&!r.catalogCandidate),true);
});
test('local packaging never counts as persisted, production-ready shipping package',()=>{
  const p={...product,localPackageOnly:true};
  const {rows,summary}=catalogLaunchReview([p]);
  assert.equal(rows[0].catalogCandidate,true);
  assert.equal(rows[0].carrierCheckoutCandidate,false);
  assert.ok(rows[0].blockers.includes('local-package-only'));
  assert.equal(summary.localOnlyPackages,1);
});
test('unknown/invalid stock and archived or unpublished records fail closed',()=>{
  const bad=[
    {...product,quantityOnHand:5,stockReserved:6,stockAvailable:-1},
    {...product,stockSource:'uninitialized'},
    {...product,status:'ARCHIVED'},
    {...product,isactive:false},
    {...product,rawSalePrice:'5.99'},
    {...product,published:undefined},
    {...product,stockVersion:null},
    {...product,stockAvailable:4},
    {...product,shippingPackage:null}
  ];
  for(const p of bad)assert.equal(catalogLaunchReview([p]).rows[0].carrierCheckoutCandidate,false);
  assert.equal(catalogLaunchReview([bad[8]]).rows[0].catalogCandidate,true);
});
test('invalid and duplicate product IDs block all ambiguous copies',()=>{
  const result=catalogLaunchReview([{...product},{...product},{...product,productId:'bad id'}]);
  assert.equal(result.summary.catalogCandidates,0);
  assert.equal(result.rows.some(x=>x.blockers.includes('duplicate-product-id')),true);
  assert.equal(result.rows.some(x=>x.blockers.includes('invalid-product-id')),true);
});
