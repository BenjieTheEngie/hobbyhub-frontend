import {safePublicProduct} from './stock-v2-logic.mjs';

/**
 * Offline-only marketplace read model. A SKU describes a card printing,
 * not an individual seller's offer. No writes, publication or payments.
 * Current legacy storefront continues using its existing guarded path.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function marketplaceListingPreview(products,balances){
  if(!Array.isArray(products)||!Array.isArray(balances))
    throw Error('Complete marketplace product and stock snapshots required.');
  const productIds=new Set(),stockIds=new Set(),stockMap=new Map();
  for(const product of products){
    if(!product||typeof product.productId!=='string'||!ID.test(product.productId)||
       productIds.has(product.productId))
      throw Error('Duplicate or invalid marketplace listing identity.');
    productIds.add(product.productId);
  }
  for(const stock of balances){
    if(!stock||typeof stock.productId!=='string'||!ID.test(stock.productId)||
       stockIds.has(stock.productId)||!Number.isSafeInteger(stock.quantityOnHand)||
       stock.quantityOnHand<0||!Number.isSafeInteger(stock.reserved)||
       stock.reserved<0||stock.reserved>stock.quantityOnHand||
       stock.quantityAvailable!==stock.quantityOnHand-stock.reserved||
       !Number.isSafeInteger(stock.version)||stock.version<1||
       !Number.isSafeInteger(stock.reorderPoint)||stock.reorderPoint<0)
      throw Error('Invalid or duplicate marketplace stock identity.');
    stockIds.add(stock.productId);
    stockMap.set(stock.productId,stock);
  }
  return products.flatMap(product=>{
    const publicItem=safePublicProduct(product,stockMap.get(product.productId));
    // An explicit publication approval must have already set published=true.
    // Seller ownership is deliberately not inferred from legacy product data.
    return publicItem?[{...publicItem,listingId:product.productId}]:[];
  });
}
