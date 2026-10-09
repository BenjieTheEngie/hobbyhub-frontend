import {measuredPackagingProfile} from './packagingWorksheet.js';

/**
 * ADMIN-ONLY prelaunch checklist. No mutation, publish action, checkout
 * authorization or inference from physical legacy Inventory counts.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
export const READINESS_LABELS=Object.freeze({
  'invalid-product-id':'Missing or ambiguous product ID',
  'duplicate-product-id':'Repeated product ID',
  'invalid-sku':'SKU missing or invalid',
  'duplicate-sku':'Duplicate SKU',
  'missing-name':'Product name missing',
  'inactive-status':'Product is not ACTIVE',
  'unapproved-publication':'Not explicitly approved for publication',
  'invalid-price':'Product price missing or invalid',
  'unknown-stock':'Verified Stock V2 balance missing',
  'unavailable-stock':'No verified available units',
  'unmeasured-package':'Packed size and weight missing',
  'local-package-only':'Packaging measurements are local-only, not verified in AWS'
});
function positivePrice(p){
  const val=p.rawSalePrice===undefined?p.salePrice:p.rawSalePrice;
  if(typeof val!=='number'||!Number.isFinite(val)||val<=0||val>50000)return false;
  return Math.abs(val*100-Math.round(val*100))<1e-6;
}
export function catalogLaunchReview(products=[]) {
  if(!Array.isArray(products))throw Error('Authenticated products must be an array.');
  const skus=new Map(),ids=new Map();
  for(const p of products){
    const id=p?.productId,sku=typeof p?.sku==='string'?p.sku.trim().toLowerCase():'';
    if(typeof id==='string'&&id)ids.set(id,(ids.get(id)||0)+1);
    if(sku)skus.set(sku,(skus.get(sku)||0)+1);
  }
  const rows=products.map((p,i)=>{
    const blockers=[];
    if(typeof p?.productId!=='string'||!ID.test(p.productId))blockers.push('invalid-product-id');
    else if(ids.get(p.productId)!==1)blockers.push('duplicate-product-id');
    const sku=typeof p?.sku==='string'?p.sku.trim():'';
    if(!SKU.test(sku))blockers.push('invalid-sku');
    else if(skus.get(sku.toLowerCase())!==1)blockers.push('duplicate-sku');
    if(typeof p?.productName!=='string'||!p.productName.trim())blockers.push('missing-name');
    if(p?.status!=='ACTIVE'||p.isactive===false||p.isActive===false)blockers.push('inactive-status');
    if(p?.published!==true||p.publicationKnown===false)blockers.push('unapproved-publication');
    if(!positivePrice(p||{}))blockers.push('invalid-price');
    const stockValid=p?.stockReported===true&&p.stockSource==='stock-v2'&&
      Number.isSafeInteger(p.stockVersion)&&p.stockVersion>=1&&
      Number.isSafeInteger(p.quantityOnHand)&&p.quantityOnHand>=0&&
      Number.isSafeInteger(p.stockReserved)&&p.stockReserved>=0&&p.stockReserved<=p.quantityOnHand&&
      Number.isSafeInteger(p.stockAvailable)&&p.stockAvailable===p.quantityOnHand-p.stockReserved;
    if(!stockValid)blockers.push('unknown-stock');
    else if(p.stockAvailable<1)blockers.push('unavailable-stock');
    const packageReady=Boolean(measuredPackagingProfile(p));
    if(!packageReady)blockers.push('unmeasured-package');
    else if(p.localPackageOnly===true)blockers.push('local-package-only');
    const catalogBlockers=blockers.filter(x=>!['unmeasured-package','local-package-only'].includes(x));
    return {
      key:typeof p?.productId==='string'&&ID.test(p.productId)?p.productId:'unidentified-'+i,
      sku,productName:String(p?.productName||'').trim()||'Unnamed product',
      blockers,catalogCandidate:catalogBlockers.length===0,
      carrierCheckoutCandidate:blockers.length===0,
      // Never indicate payment readiness: checkout requires webhooks, tax,
      // orders, signed reservations and production carrier quotes.
      paymentReady:false
    };
  });
  const blockers=Object.fromEntries(Object.keys(READINESS_LABELS).map(k=>[k,0]));
  for(const row of rows)for(const reason of row.blockers)blockers[reason]++;
  return {
    rows,
    summary:{
      total:rows.length,catalogCandidates:rows.filter(x=>x.catalogCandidate).length,
      carrierCheckoutCandidates:rows.filter(x=>x.carrierCheckoutCandidate).length,
      unapproved:rows.filter(x=>x.blockers.includes('unapproved-publication')).length,
      unknownStock:rows.filter(x=>x.blockers.includes('unknown-stock')).length,
      localOnlyPackages:rows.filter(x=>x.blockers.includes('local-package-only')).length,
      duplicateSkuGroups:[...skus.values()].filter(x=>x>1).length,
      paymentReady:false,blockers
    }
  };
}
