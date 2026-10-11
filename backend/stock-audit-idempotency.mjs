export function stockAuditIdempotency(existing,request){
 if(!request||typeof request.requestId!=='string'||!request.requestId||typeof request.productId!=='string'||!request.productId)throw Error('Valid request identity required.');
 if(!existing)return {action:'CREATE'};
 const fields=['requestId','productId','operation','delta','onHand','expectedVersion','reason'];
 return {action:fields.every(k=>existing[k]===request[k])?'REPLAY':'CONFLICT'};
}
