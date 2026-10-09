/**
 * Shipping setup worksheet is LOCAL-ONLY. It is a blank measurement guide,
 * not an AWS inventory mutation or a carrier quote. Each physical productId
 * stays distinct even if legacy rows have duplicate SKUs.
 *
 * Packed dimensions are inches. Weight is ounces. Measure *including*
 * cardboard/padding/protective sleeves, not just the bare product.
 */
export const PACKAGING_COLUMNS=Object.freeze([
  'productId','sku','productName','category','condition','finish',
  'packedLengthIn','packedWidthIn','packedHeightIn','packedWeightOz','packagingNotes'
]);
function quoteCell(value){
  let str=String(value??'');
  // Neutralize spreadsheet formulas including leading whitespace and 	.
  if(/^[\s]*[=+@\-]/.test(str))str="'"+str;
  if(/[",\r\n]/.test(str))str='"'+str.replace(/"/g,'""')+'"';
  return str;
}
export function measuredPackagingProfile(product) {
  const p=product?.shippingPackage;
  if(!p||typeof p!=='object'||Array.isArray(p))return null;
  const fields=['lengthIn','widthIn','heightIn','weightOz'];
  const values=fields.map(k=>p[k]);
  if(values.some((x,i)=>typeof x!=='number'||!Number.isFinite(x)||x<=0||
    (i===3?x>1120:x>48)||Math.abs(x*10-Math.round(x*10))>1e-8))return null;
  return {packedLengthIn:p.lengthIn,packedWidthIn:p.widthIn,
    packedHeightIn:p.heightIn,packedWeightOz:p.weightOz};
}
export function packagingReadiness(products=[]) {
  if(!Array.isArray(products))throw Error('A verified product list is required.');
  const ids=new Set();
  let ready=0,missing=0,ambiguous=0;
  for(const p of products){
    const id=String(p?.productId||'');
    if(!id||ids.has(id)){ambiguous++;continue;}
    ids.add(id);
    if(measuredPackagingProfile(p))ready++;else missing++;
  }
  return {total:products.length,ready,missing,ambiguous};
}
export function packagingWorksheetCsv(products) {
  if(!Array.isArray(products))throw Error('Inventory records are required.');
  if(products.length>15000)throw Error('Too many products for a local worksheet.');
  const seen=new Set();
  const rows=[PACKAGING_COLUMNS.join(',')];
  for(const p of products){
    const id=String(p?.productId||'');
    if(!id||seen.has(id))throw Error('Every worksheet row must have a unique productId. Resolve identities before export.');
    seen.add(id);
    const measurements=measuredPackagingProfile(p)||{};
    const row={
      productId:id,sku:String(p.sku||''),productName:String(p.productName||''),
      category:String(p.category||''),condition:String(p.condition||''),
      finish:String(p.finish||''),...measurements,packagingNotes:''
    };
    rows.push(PACKAGING_COLUMNS.map(k=>quoteCell(row[k])).join(','));
  }
  return '\uFEFF'+rows.join('\r\n')+'\r\n';
}
