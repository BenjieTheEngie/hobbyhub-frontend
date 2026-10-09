import {measuredPackagingProfile} from './packagingWorksheet.js';

export const PUBLICATION_BLOCKERS=Object.freeze({
  identity:'Missing immutable productId or SKU',
  duplicate:'Duplicate SKU in legacy inventory',
  name:'Missing product name',
  inactive:'Product is not confirmed active',
  price:'Missing or invalid positive USD price',
  publication:'Not explicitly approved for public sale',
  stock:'Stock V2 available-to-sell quantity is not verified positive',
  packaging:'Server-stored packed dimensions and weight are missing',
});
export function catalogReadinessRows(products=[]) {
  if(!Array.isArray(products))throw Error('Verified inventory records are required.');
  const skuCount=new Map(),seenIds=new Set();
  for(const p of products){
    const sku=typeof p?.sku==='string'?p.sku.trim().toLowerCase():'';
    if(sku)skuCount.set(sku,(skuCount.get(sku)||0)+1);
  }
  return products.map((p,index)=>{
    const sku=String(p?.sku||'').trim(),id=p?.productId;
    const issues=[];
    if(typeof id!=='string'||!id.trim()||!sku||seenIds.has(id))issues.push('identity');
    if(id)seenIds.add(id);
    if(sku && (skuCount.get(sku.toLowerCase())||0)>1)issues.push('duplicate');
    if(!String(p?.productName||'').trim())issues.push('name');
    if(p?.isactive===false || p?.isActive===false || (p?.status!=null&&p.status!=='ACTIVE'))
      issues.push('inactive');
    const price=Number(p?.salePrice);
    if(!Number.isFinite(price)||price<=0||price>50000||
      Math.abs(price*100-Math.round(price*100))>1e-6)issues.push('price');
    if(p?.published!==true)issues.push('publication');
    if(p?.stockSource!=='stock-v2' || p.stockReported!==true||
       !Number.isSafeInteger(p.stockVersion)||p.stockVersion<1||
       !Number.isSafeInteger(p.quantityOnHand)||p.quantityOnHand<0||
       !Number.isSafeInteger(p.stockReserved)||p.stockReserved<0||
       p.stockReserved>p.quantityOnHand||
       !Number.isSafeInteger(p.stockAvailable)||p.stockAvailable!==p.quantityOnHand-p.stockReserved||
       p.stockAvailable<1)issues.push('stock');
    // Browser-local measured drafts DO NOT make a product shipping-ready.
    if(p?.localPackageOnly===true||!measuredPackagingProfile(p))issues.push('packaging');
    return {
      productId:typeof id==='string'?id:null,
      sku,productName:String(p?.productName||'').trim()||'(Unnamed)',
      listIndex:index,issues,ready:issues.length===0,
      imageAdvisory:!(typeof p?.imageUrl==='string'&&/^https:\/\//i.test(p.imageUrl)),
    };
  });
}
export function catalogReadinessSummary(rows){
  if(!Array.isArray(rows))throw Error('Catalog review rows required.');
  return {
    total:rows.length,
    eligible:rows.filter(x=>x.ready).length,
    unpublished:rows.filter(x=>x.issues.includes('publication')).length,
    stockUnverified:rows.filter(x=>x.issues.includes('stock')).length,
    packagingMissing:rows.filter(x=>x.issues.includes('packaging')).length,
    duplicateSku:rows.filter(x=>x.issues.includes('duplicate')).length,
    lackingImages:rows.filter(x=>x.imageAdvisory).length,
    nonMutating:true,
  };
}
