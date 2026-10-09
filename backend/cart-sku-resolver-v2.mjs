import {validateCheckoutIntent} from './checkout-v2-core.mjs';

/**
 * Off-line SKU -> immutable productId bridge.
 *
 * Existing public cart stores SKU only. We deliberately avoid exposing
 * internal productId in the public catalog. A FUTURE authorized checkout
 * endpoint must fetch the COMPLETE original Products set from AWS, detect
 * ambiguous case-insensitive SKU groups (including archived/unpublished
 * records), then map an explicitly approved sellable SKU to its physical ID.
 *
 * This has no AWS client, read side effects, reservations or payment calls.
 */
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function verifiedCartSkuIntent({requestId,items}={},products,productsComplete=false) {
  if(productsComplete!==true||!Array.isArray(products))
    throw Error('Complete source Products snapshot is required to resolve cart SKUs.');
  if(typeof requestId!=='string'||!UUID.test(requestId))
    throw Error('Valid checkout idempotency ID is required.');
  if(!Array.isArray(items)||items.length<1||items.length>20)
    throw Error('Checkout cart requires 1 to 20 lines.');
  const indexed=new Map();
  const allIds=new Set();
  for(const product of products){
    const id=product?.productId;
    if(typeof id!=='string'||!ID.test(id)||allIds.has(id))
      throw Error('Source Products snapshot has an invalid/duplicate productId.');
    allIds.add(id);
    const sku=product.sku;
    if(typeof sku!=='string'||!SKU.test(sku.trim()))
      throw Error('Source Products snapshot includes an invalid SKU.');
    const key=sku.trim().toLowerCase();
    const bucket=indexed.get(key)||[];
    bucket.push(product);
    indexed.set(key,bucket);
  }
  const seen=new Set();
  const approved=items.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).some(k=>!['sku','qty'].includes(k)))
      throw Error('Cart may contain only a SKU and integer quantity.');
    const sku=row.sku;
    if(typeof sku!=='string'||!SKU.test(sku.trim()))
      throw Error('Cart SKU is missing or invalid.');
    const key=sku.trim().toLowerCase();
    if(seen.has(key))throw Error('Duplicate cart SKU lines are not allowed.');
    seen.add(key);
    const candidates=indexed.get(key)||[];
    if(candidates.length!==1)
      throw Error('Cart SKU is missing or ambiguous among legacy records.');
    const product=candidates[0];
    if(product.published!==true||product.isactive===false||product.isActive===false||
       (product.status!==undefined&&product.status!=='ACTIVE'))
      throw Error('Cart contains an unapproved or inactive product.');
    return {productId:product.productId,qty:row.qty};
  });
  const intent=validateCheckoutIntent({requestId,items:approved});
  return {...intent,sourceProductsComplete:true,mustReverifyPriceAndStock:true,
    checkoutReady:false,paymentAuthorized:false};
}

/**
 * Safe outward request model for the CURRENT browser shopping list.
 * Does not call checkout. Prices, weights and on-hand counts are ignored.
 */
export function publicCartSkuRequest(cart,requestId) {
  if(!Array.isArray(cart))throw Error('Valid browser cart required.');
  const items=cart.map(item=>({sku:item?.sku,qty:item?.cartQuantity}));
  // The server's complete-snapshot bridge is the actual authority.
  // These checks reject malformed local entries early, not confirm sale.
  if(typeof requestId!=='string'||!UUID.test(requestId)||items.length<1||items.length>20||
    items.some(x=>typeof x.sku!=='string'||!SKU.test(x.sku)||
      !Number.isSafeInteger(x.qty)||x.qty<1||x.qty>20))
    throw Error('Cart cannot be submitted for future verified checkout.');
  return {requestId,items};
}
