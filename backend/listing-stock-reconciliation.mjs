import {stockBalance} from './stock-v2-logic.mjs';
export function reconcileListingStock(productId,rawStock,physicalCount){
 if(typeof productId!=='string'||!productId||!Number.isSafeInteger(physicalCount)||physicalCount<0)throw Error('Verified product and physical count required.');
 const balance=stockBalance(rawStock);
 if(!balance||balance.productId!==productId)return {reconciled:false,reason:'NO_VERIFIED_STOCK'};
 if(balance.reserved>0)return {reconciled:false,reason:'OUTSTANDING_RESERVATIONS'};
 return {reconciled:balance.quantityAvailable===physicalCount,reason:balance.quantityAvailable===physicalCount?'MATCH':'COUNT_MISMATCH',available:balance.quantityAvailable,physicalCount};
}
