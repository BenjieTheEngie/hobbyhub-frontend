/** Read-only comparison of seller assertions against a persisted product row. */
export function firstListingMetadataPreflight(product,expectation){
  if(!product||!expectation||typeof product!=='object'||typeof expectation!=='object')
    throw Error('Product and seller expectation are required.');
  const fields=['productId','sku','productName','category','finish','setCode','collectorNumber','condition','language','imageUrl'];
  const checks=[];
  for(const field of fields){
    const expected=expectation[field];
    if(expected===undefined)continue;
    if(typeof expected!=='string'||!expected.trim())
      throw Error('Expected '+field+' must be a nonempty string.');
    const actual=product[field];
    checks.push({field,expected,actual:typeof actual==='string'?actual:null,
      verified:typeof actual==='string'&&actual===expected});
  }
  if(!checks.some(x=>x.field==='productId'))
    throw Error('Exact immutable productId must be supplied.');
  if(!checks.some(x=>x.field==='finish'))
    throw Error('Explicit finish must be verified before first listing publication.');
  if(!checks.some(x=>x.field==='productName'))
    throw Error('Product name must be verified before publication.');
  return {productId:product.productId,
    verified:checks.every(x=>x.verified),checks,
    // A missing physical finish is a blocker, not permission to infer it from SKU.
    missing:checks.filter(x=>x.actual===null).map(x=>x.field),
    mismatched:checks.filter(x=>x.actual!==null&&!x.verified).map(x=>x.field)};
}
