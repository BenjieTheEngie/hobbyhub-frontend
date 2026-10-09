import {MAX_LINES,MAX_QUANTITY,validateCheckoutIntent} from './checkout-v2-core.mjs';

/**
 * Bridge between the public SKU-only shopping list and the immutable
 * productId checkout model. Pure server-side transformation only.
 *
 * COMPLETE strongly-consistent Products snapshot is mandatory: historical
 * SKU duplicates (even unpublished records) invalidate that SKU.
 *
 * Do not accept products or productId from a customer's HTTP request. A
 * future authenticated checkout API must fetch the complete original AWS
 * Products table server-side before invoking this resolver.
 */
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function normalizeStorefrontSkuIntent(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw Error('A SKU shopping cart request is required.');
  const allowed=new Set(['requestId','items']);
  if(Object.keys(payload).some(k=>!allowed.has(k)))
    throw Error('Shopper input may only include a request ID and SKU lines.');
  if(!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>MAX_LINES)
    throw Error('Cart needs between 1 and 20 SKU lines.');
  const seen=new Set();
  const items=payload.items.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||
      Object.keys(line).some(k=>!['sku','qty'].includes(k)))
      throw Error('Shopper cart lines may contain only SKU and quantity.');
    const sku=typeof line.sku==='string'?line.sku.trim():'';
    if(!SKU.test(sku))throw Error('Cart has an invalid SKU.');
    if(!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>MAX_QUANTITY)
      throw Error('Cart quantity must be a whole number between 1 and 20.');
    const key=sku.toLowerCase();
    if(seen.has(key))throw Error('Cart contains duplicate SKU lines.');
    seen.add(key);
    return {sku,qty:line.qty};
  });
  // Let the existing UUID validator reject forged or malformed request IDs
  // after the Products table has been resolved.
  return {requestId:payload.requestId,items};
}
export function resolveSkuCartToProductIntent({
  shopperRequest,allProducts,productsComplete=false
}={}){
  const cart=normalizeStorefrontSkuIntent(shopperRequest);
  if(productsComplete!==true||!Array.isArray(allProducts))
    throw Error('Complete server-owned Products snapshot is required.');
  if(allProducts.length>100000)
    throw Error('Products scan exceeds safe checkout resolution bounds.');
  const bySku=new Map();
  const ids=new Set();
  for(const product of allProducts){
    const productId=product?.productId;
    if(typeof productId!=='string'||!ID.test(productId)||ids.has(productId))
      throw Error('Product snapshot has a missing or duplicate productId.');
    ids.add(productId);
    const sku=typeof product.sku==='string'?product.sku.trim():'';
    if(!SKU.test(sku))
      throw Error('Product snapshot contains an invalid SKU; stock lookup is not safe.');
    const key=sku.toLowerCase();
    const bucket=bySku.get(key)||[];
    bucket.push(product);
    bySku.set(key,bucket);
  }
  const resolved=[];
  for(const line of cart.items){
    const rows=bySku.get(line.sku.toLowerCase())||[];
    if(rows.length!==1)throw Error('Requested SKU is missing or ambiguous in Products.');
    const record=rows[0];
    if(record.published!==true || record.status!=='ACTIVE' ||
      record.isactive===false || record.isActive===false)
      throw Error('Requested SKU is not approved for sale.');
    resolved.push({productId:record.productId,qty:line.qty});
  }
  return validateCheckoutIntent({requestId:cart.requestId,items:resolved});
}
/** Non-sensitive confirmation: no prices, shipping or payment authorization. */
export function resolvedSkuCartSummary(intent){
  if(!intent||!Array.isArray(intent.items))throw Error('A valid resolved cart is required.');
  return {lines:intent.items.length,totalUnits:intent.items.reduce((a,b)=>a+b.qty,0),
    checkoutReady:false,stockReserved:false,paymentEnabled:false};
}
