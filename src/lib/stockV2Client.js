/**
 * Stock V2 browser adapter. Calls only a separately deployed opt-in API.
 * Without VITE_STOCK_API_BASE_URL the live legacy admin remains unchanged.
 */
export function normalizeStockResponse(response) {
  if(!response || !Array.isArray(response.items))throw Error('Stock service returned an invalid snapshot.');
  const byId=new Map();
  for(const row of response.items){
    if(!row || typeof row.productId!=='string'||!row.productId.trim())throw Error('Stock service returned an unidentified product.');
    if(byId.has(row.productId))throw Error('Stock service returned duplicate product IDs.');
    const qty=row.quantityOnHand,point=row.reorderPoint,version=row.version,reserved=row.reserved;
    if(!Number.isSafeInteger(qty)||qty<0||
       !Number.isSafeInteger(reserved)||reserved<0||reserved>qty||
       row.quantityAvailable!==qty-reserved||
       !Number.isSafeInteger(point)||point<0||
       !Number.isSafeInteger(version)||version<1)throw Error('Stock service returned an invalid count or version.');
    byId.set(row.productId,{quantityOnHand:qty,stockReserved:reserved,stockAvailable:qty-reserved,reorderPoint:point,stockVersion:version,
      stockUpdatedAt:typeof row.updatedAt==='string'?row.updatedAt:null});
  }
  return byId;
}
export function mergeVerifiedStock(products,stockById) {
  if(!Array.isArray(products)||!(stockById instanceof Map))throw Error('Verified inventory and stock snapshot required.');
  return products.map(p=>{
    const balance=stockById.get(p.productId);
    if(!balance)return {...p,quantityOnHand:0,stockReserved:null,stockAvailable:null,stockReported:false,stockSource:'uninitialized',stockVersion:null};
    return {...p,...balance,stockReported:true,stockSource:'stock-v2'};
  });
}
export function computeNewStock(oldQuantity,change) {
  if(!Number.isSafeInteger(oldQuantity)||oldQuantity<0||!Number.isSafeInteger(change)||change===0||
    Math.abs(change)>100000||oldQuantity+change<0||oldQuantity+change>10000000)throw Error('Stock change exceeds allowed limits or would create negative stock.');
  return oldQuantity+change;
}
export function ensureAdjustedStockAvailable(product,delta) {
  const next=computeNewStock(product?.quantityOnHand,delta);
  if(!Number.isSafeInteger(product?.stockReserved)||product.stockReserved<0||next<product.stockReserved)
    throw Error('Adjustment would reduce stock below units reserved for orders.');
  return next;
}

export function canEditStock(product,serviceStatus) {
  return serviceStatus==='ready' && typeof product?.productId==='string' && Boolean(product.productId)
    && product.stockReported===true && Number.isSafeInteger(product.stockVersion)&&product.stockVersion>=1;
}
export async function stockRequest(base,token,path,method='GET',data) {
  if(!/^https:\/\//i.test(base||''))throw Error('Verified HTTPS stock API URL is not configured.');
  if(!token)throw Error('Admin authentication is required for stock.');
  const response=await fetch(base.replace(/\/$/,'')+path,{
    method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.message||'Stock API request failed ('+response.status+').');
  return body;
}
export function verifiedAdjustmentReply(payload,requestedId,requestedAfter) {
  return payload?.applied===true && payload.adjustment?.requestId===requestedId &&
    payload.adjustment.afterOnHand===requestedAfter;
}
