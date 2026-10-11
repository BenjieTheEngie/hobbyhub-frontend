import {publicationFingerprint,approvalForProduct} from './publication-approvals.mjs';
import {stockBalance} from './stock-v2-logic.mjs';

/** Read-only readiness report for one existing productId. No AWS writes. */
export function firstListingReadiness({product,stock,approval,expectedPrice,expectedQuantity}){
  if(!product||typeof product.productId!=='string'||!product.productId)
    throw Error('Verified original product record required.');
  const checks=[];
  const add=(code,ok,detail)=>checks.push({code,ok:Boolean(ok),detail});
  add('product-identity',/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(product.productId),
    'Product identity must be immutable and verified.');
  add('price',typeof product.salePrice==='number'&&product.salePrice===expectedPrice,
    'Original product price must match the seller-confirmed price.');
  let fingerprint=null;
  try{fingerprint=publicationFingerprint(product);}catch{}
  add('metadata',Boolean(fingerprint),'Active product and valid public metadata required.');
  const balance=stockBalance(stock);
  add('verified-stock',Boolean(balance&&balance.productId===product.productId),
    'Stock V2 requires a verified balance for the exact product ID.');
  add('physical-count',Boolean(balance&&balance.quantityAvailable===expectedQuantity),
    'Available stock must match the seller-confirmed count.');
  add('publication-approval',approvalForProduct(product,approval),
    'Explicit fingerprint-matched approval must be recorded separately.');
  return {productId:product.productId,ready:checks.every(c=>c.ok),
    checks,fingerprint,quantityAvailable:balance?.quantityAvailable??null,
    // This is a readiness report only, never permission to activate payments.
    paymentsEnabled:false};
}
