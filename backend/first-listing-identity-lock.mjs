const ID='prd_9bfd1285-899c-45cb-869c-6058aff5b424';
export function verifyFirstListingIdentity(product){
 if(!product||typeof product!=='object')return {verified:false,reason:'MISSING_PRODUCT'};
 if(product.productId!==ID)return {verified:false,reason:'PRODUCT_ID_MISMATCH'};
 if(product.sku!=='MTG-SLD-IFIYW-7-F'||product.productName!=='Lightning Bolt')return {verified:false,reason:'PRODUCT_METADATA_MISMATCH'};
 if(product.salePrice!==7.50)return {verified:false,reason:'PRICE_MISMATCH'};
 return {verified:true,productId:ID};
}
