/**
 * Inventory quality, filtering and export are intentionally read-only.
 * Records use productId as a physical identity, while SKU is a business label
 * which is NOT unique in the existing legacy AWS table.
 */
export const INVENTORY_VIEWS = [
  ['all','All records'],
  ['review','Needs review'],
  ['duplicates','Duplicate SKUs'],
  ['missing-stock','Unknown stock'],
  ['invalid-price','Price issues'],
  ['archived','Archived'],
];

export function money(value) {
  const n=Number(value);
  return Number.isFinite(n) && n>=0 ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n) : 'Review';
}
export function skuCounts(products) {
  const map=new Map();
  for(const p of products) {
    const sku=String(p?.sku||'').trim().toLowerCase();
    if(sku) map.set(sku,(map.get(sku)||0)+1);
  }
  return map;
}
export function productIssues(product,counts) {
  const issues=[];
  const sku=String(product?.sku||'').trim();
  if(!sku)issues.push('missing-sku');
  if(sku && (counts.get(sku.toLowerCase())||0)>1)issues.push('duplicate-sku');
  if(product?.stockReported!==true)issues.push('unknown-stock');
  const price=product?.rawSalePrice ?? product?.salePrice;
  if(price==null || String(price).trim()==='' || product?.priceInvalid===true || !Number.isFinite(Number(price)) || Number(price)<0)issues.push('invalid-price');
  else if(Number(price)===0)issues.push('zero-price');
  if(!String(product?.productName||'').trim())issues.push('missing-name');
  if(!String(product?.productId||'').trim() && !String(product?.sku||'').trim())issues.push('missing-identity');
  return issues;
}
export function inventorySummary(products) {
  const counts=skuCounts(products);
  let review=0,unknownStock=0,priceIssues=0,archived=0;
  const categories=new Set();
  const duplicateSkus=[...counts.values()].filter(n=>n>1).length;
  for(const product of products){
    const issues=productIssues(product,counts);
    if(issues.length)review++;
    if(issues.includes('unknown-stock'))unknownStock++;
    if(issues.includes('invalid-price')||issues.includes('zero-price'))priceIssues++;
    if(product?.isactive===false || product?.isActive===false)archived++;
    if(product?.category)categories.add(product.category);
  }
  return {
    records:products.length,
    uniqueSkus:counts.size,
    duplicateSkus,
    review,
    unknownStock,
    priceIssues,
    archived,
    categories:[...categories].sort((a,b)=>a.localeCompare(b)),
  };
}
export function inventorySearch(products,{query='',category='All',view='all',sort='name'}={}) {
  const counts=skuCounts(products);
  const q=query.trim().toLocaleLowerCase();
  const subset=products.filter(p=>{
    if(category!=='All' && p.category!==category)return false;
    const haystack=[p.productName,p.sku,p.productId,p.category,p.setCode,p.collectorNumber,p.condition,p.finish].map(v=>String(v||'').toLocaleLowerCase()).join(' ');
    if(q && !haystack.includes(q))return false;
    const issues=productIssues(p,counts);
    if(view==='review' && issues.length===0)return false;
    if(view==='duplicates' && !issues.includes('duplicate-sku'))return false;
    if(view==='missing-stock' && !issues.includes('unknown-stock'))return false;
    if(view==='invalid-price' && !issues.includes('invalid-price') && !issues.includes('zero-price'))return false;
    if(view==='archived' && p.isactive!==false && p.isActive!==false)return false;
    if(view==='active' && (p.isactive===false || p.isActive===false))return false;
    return true;
  });
  return [...subset].sort((a,b)=>{
    if(sort==='newest')return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    if(sort==='sku')return String(a.sku||'').localeCompare(String(b.sku||'')) ||
      String(a.productId||'').localeCompare(String(b.productId||''));
    if(sort==='price-low')return Number(a.salePrice||0)-Number(b.salePrice||0);
    if(sort==='price-high')return Number(b.salePrice||0)-Number(a.salePrice||0);
    if(sort==='issues')return productIssues(b,counts).length-productIssues(a,counts).length || String(a.productName||'').localeCompare(String(b.productName||''));
    return String(a.productName||'').localeCompare(String(b.productName||'')) ||
      String(a.productId||'').localeCompare(String(b.productId||''));
  });
}
export const INVENTORY_EXPORT_FIELDS=[
  'productId','sku','productName','category','salePrice','quantityOnHand','stockReported',
  'condition','finish','setCode','collectorNumber','isactive','published','createdAt','issues',
];
function escapeCsvCell(value) {
  // Neutralize spreadsheet formulas so exported product names cannot run on open.
  let s=String(value??'');
  if(/^[\s]*[=+@\-]/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
export function inventoryAuditCsv(products) {
  const counts=skuCounts(products);
  const lines=[INVENTORY_EXPORT_FIELDS.join(',')];
  for(const p of products) {
    const row={
      ...p,
      salePrice:p.rawSalePrice??p.salePrice,
      quantityOnHand:p.stockReported===true?p.quantityOnHand:'UNKNOWN',
      published:p.publicationKnown===false?'UNKNOWN':p.published,
      isactive:p.activeStatusKnown===false?'UNKNOWN':p.isactive,
      issues:productIssues(p,counts).join('; '),
    };
    lines.push(INVENTORY_EXPORT_FIELDS.map(k=>escapeCsvCell(row[k])).join(','));
  }
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
export function recordKey(product,index=0) {
  const id=typeof product?.productId==='string'?product.productId.trim():'';
  return id?'id:'+id:'sku:'+String(product?.sku||'')+':'+index;
}
