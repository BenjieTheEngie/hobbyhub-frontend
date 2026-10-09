import {validateCheckoutIntent,verifyCheckoutQuote} from './checkout-v2-core.mjs';

/**
 * A public cart may carry SKU labels; the server must resolve to the immutable
 * physical productId from a COMPLETE product scan. Never trust a client-
 * supplied productId, price, product name, package weight, or stock count.
 *
 * This is pure / OFFLINE and never submits a payment or stock mutation.
 */
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePublicSkuCart(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('A shopping-cart request object is required.');
  if(Object.keys(input).some(k=>!['requestId','items'].includes(k)))
    throw Error('Shopper cannot supply product details, prices or shipping rates.');
  if(typeof input.requestId!=='string'||!UUID.test(input.requestId))
    throw Error('A valid checkout request ID is required.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)
    throw Error('Shopping cart must contain 1 to 20 products.');
  const seen=new Set();
  const items=input.items.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||
       Object.keys(line).some(k=>!['sku','qty'].includes(k)))
      throw Error('Each cart line may contain only SKU and quantity.');
    if(typeof line.sku!=='string'||!SKU.test(line.sku))
      throw Error('Invalid SKU in cart.');
    if(!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>20)
      throw Error('Invalid cart quantity.');
    const key=line.sku.toLowerCase();
    if(seen.has(key))throw Error('Duplicate SKU line in cart.');
    seen.add(key);
    return {sku:line.sku,qty:line.qty};
  });
  return {requestId:input.requestId.toLowerCase(),items};
}
export function resolvePublicSkuCart(publicCart,{
  allProducts,productsComplete=false,allStock=[],stockComplete=false
}={}) {
  if(productsComplete!==true||stockComplete!==true||
     !Array.isArray(allProducts)||!Array.isArray(allStock))
    throw Error('Complete server-owned products and stock snapshots are required.');
  const parsed=validatePublicSkuCart(publicCart);
  const counts=new Map(),skus=new Map(),productsById=new Map(),stockById=new Map();
  for(const p of allProducts){
    if(!p||typeof p.productId!=='string'||!p.productId.trim()||
      productsById.has(p.productId))throw Error('Product identities are incomplete or duplicated.');
    productsById.set(p.productId,p);
    const key=typeof p.sku==='string'?p.sku.trim().toLowerCase():'';
    if(key){
      counts.set(key,(counts.get(key)||0)+1);
      if(!skus.has(key))skus.set(key,p);
    }
  }
  for(const s of allStock){
    if(!s||typeof s.productId!=='string'||!s.productId.trim()||
       stockById.has(s.productId))throw Error('Stock identities are incomplete or duplicated.');
    if(!productsById.has(s.productId))throw Error('Stock contains an orphaned productId.');
    if(!Number.isSafeInteger(s.version)||s.version<1||
       !Number.isSafeInteger(s.onHand)||s.onHand<0||
       !Number.isSafeInteger(s.reserved)||s.reserved<0||s.reserved>s.onHand)
      throw Error('Stock contains an invalid reserved/on-hand balance.');
    stockById.set(s.productId,s);
  }
  const items=parsed.items.map(line=>{
    const key=line.sku.toLowerCase();
    const product=skus.get(key);
    if(counts.get(key)!==1||!product)
      throw Error('Cart item SKU is ambiguous or no longer available.');
    if(product.published!==true||product.status&&product.status!=='ACTIVE'||
       product.isactive===false||product.isActive===false)
      throw Error('Cart item is not approved for publication.');
    return {productId:product.productId,qty:line.qty};
  });
  const intent=validateCheckoutIntent({requestId:parsed.requestId,items});
  const quote=verifyCheckoutQuote(intent,{productsById,stockById,skuCounts:counts});
  return {
    intent,quote,productsById,stockById,skuCounts:counts,
    // Explicitly not a customer-facing payload. Contains internal IDs.
    internalOnly:true,chargeable:false
  };
}
export function publicSkuQuoteSummary(resolved) {
  if(resolved?.internalOnly!==true||resolved.chargeable!==false)
    throw Error('Verified internal cart translation required.');
  const quote=resolved.quote;
  if(!quote||quote.checkoutReady!==false||quote.totalCents!==null)
    throw Error('Precheckout must remain unchargeable.');
  // NEVER send internal productId or source stock versions to public clients.
  return {
    currency:'usd',subtotalCents:quote.subtotalCents,
    items:quote.items.map(x=>({
      sku:x.sku,productName:x.productName,qty:x.qty,
      unitPriceCents:x.unitPriceCents,lineTotalCents:x.lineTotalCents
    })),
    shippingCents:null,taxCents:null,totalCents:null,
    checkoutReady:false,paymentEnabled:false
  };
}
