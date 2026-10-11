/** Stock v2 uses immutable productId, never SKU, as its physical key. */
export const MAX_UNITS = 10000000;
export const MAX_ADJUSTMENT = 100000;
export const VALID_REASONS = Object.freeze(['initial-count','restock','cycle-count','customer-return','damage','correction','other']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validProductId(id) {
  if(typeof id!=='string' || !ID.test(id))throw Error('Invalid productId.');
  return id;
}
export function validRequestId(id) {
  if(typeof id!=='string' || !REQUEST_ID.test(id))throw Error('Invalid idempotency request ID.');
  return id.toLowerCase();
}
export function nonnegativeWhole(value,label='Stock quantity') {
  if(typeof value!=='number' || !Number.isSafeInteger(value) || value<0 || value>MAX_UNITS)throw Error(label+' must be a nonnegative whole number within limits.');
  return value;
}
function readReason(input) {
  if(!VALID_REASONS.includes(input?.reason))throw Error('Invalid stock adjustment reason.');
  const note=String(input?.note??'').trim();
  if(note.length>160)throw Error('Stock adjustment note is too long.');
  return {reason:input.reason,note};
}
export function validateInitialization(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw Error('Stock initialization requires an object.');
  const onHand=nonnegativeWhole(input.onHand,'Initial stock');
  const reorderPoint=nonnegativeWhole(input.reorderPoint,'Reorder point');
  const requestId=validRequestId(input.requestId);
  const {reason,note}=readReason(input);
  if(reason!=='initial-count')throw Error('Initialization reason must be initial-count.');
  return {onHand,reorderPoint,requestId,reason,note};
}
export function validateAdjustment(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw Error('Stock adjustment requires an object.');
  const delta=input.delta;
  if(typeof delta!=='number' || !Number.isSafeInteger(delta) || delta===0 || Math.abs(delta)>MAX_ADJUSTMENT)throw Error('Stock delta must be a nonzero whole number within limits.');
  const expectedVersion=nonnegativeWhole(input.expectedVersion,'Expected version');
  if(expectedVersion<1)throw Error('Expected version must be at least one.');
  const requestId=validRequestId(input.requestId);
  const {reason,note}=readReason(input);
  if(reason==='initial-count')throw Error('Use the initialization route for opening stock.');
  return {delta,expectedVersion,requestId,reason,note};
}
export function stockBalance(item) {
  if(!item||typeof item!=='object'||typeof item.productId!=='string')return null;
  try {
    validProductId(item.productId);
    nonnegativeWhole(item.onHand);
    nonnegativeWhole(item.reserved,'Reserved units');
    if(item.reserved>item.onHand)return null;
    nonnegativeWhole(item.reorderPoint,'Reorder point');
    if(!Number.isSafeInteger(item.version)||item.version<1)return null;
    return {productId:item.productId,quantityOnHand:item.onHand,reserved:item.reserved,
      quantityAvailable:item.onHand-item.reserved,reorderPoint:item.reorderPoint,
      version:item.version,updatedAt:typeof item.updatedAt==='string'?item.updatedAt:null};
  }catch{return null;}
}
/**
 * Never silently drop malformed/duplicate balances from administrative or
 * public snapshots. Such partial reads could misrepresent inventory health.
 */
export function verifiedStockRows(rows) {
  if(!Array.isArray(rows))throw Error('Stock snapshot must be a complete list.');
  const ids=new Set();
  return rows.map(row=>{
    const parsed=stockBalance(row);
    if(!parsed)throw Error('Stock snapshot contains an invalid reserved/on-hand balance.');
    if(ids.has(parsed.productId))throw Error('Stock snapshot contains duplicate product IDs.');
    ids.add(parsed.productId);
    return parsed;
  });
}
export function ownRecord(record,productId,request,operation) {
  if(!record||record.productId!==productId||record.operation!==operation||record.requestId!==request.requestId)return false;
  if(operation==='initialize')return record.onHand===request.onHand && record.reorderPoint===request.reorderPoint;
  return record.delta===request.delta && record.expectedVersion===request.expectedVersion && record.reason===request.reason;
}
export function safePublicProduct(product,stock) {
  if(!product||product.published!==true||product.isactive===false||product.isActive===false||
     (product.status!==undefined&&product.status!=='ACTIVE')||!stock)return null;
  const sku=String(product.sku||'').trim(), name=String(product.productName||product.name||'').trim();
  const price=Number(product.salePrice);
  if(!sku||!name||!Number.isFinite(price)||price<=0||price>50000||
     Math.abs(price*100-Math.round(price*100))>1e-6||
     typeof product.productId!=='string'||product.productId!==stock.productId)return null;
  if(!Number.isSafeInteger(stock.quantityOnHand)||!Number.isSafeInteger(stock.reserved)||
     stock.reserved<0||stock.reserved>stock.quantityOnHand||
     stock.quantityOnHand-stock.reserved<1)return null;
  const url=typeof product.imageUrl==='string' && /^https:\/\//i.test(product.imageUrl)?product.imageUrl:'';
  return {sku,productName:name,published:true,isactive:true,category:product.category||'Accessories',salePrice:price,
    quantityOnHand:stock.quantityOnHand-stock.reserved,imageUrl:url,setCode:product.setCode||'',collectorNumber:product.collectorNumber||'',
    condition:product.condition||'',finish:product.finish||'',language:product.language||''};
}
export function joinedPublicCatalog(products,balances) {
  if(!Array.isArray(products))throw Error('Complete product snapshot required.');
  if(!Array.isArray(balances))throw Error('Stock snapshot must be a complete list.');
  const stocks=new Map();
  for(const row of balances){
    if(!row||typeof row.productId!=='string'||!ID.test(row.productId)||
       !Number.isSafeInteger(row.quantityOnHand)||row.quantityOnHand<0||
       !Number.isSafeInteger(row.reserved)||row.reserved<0||row.reserved>row.quantityOnHand||
       row.quantityAvailable!==row.quantityOnHand-row.reserved||
       !Number.isSafeInteger(row.version)||row.version<1||
       !Number.isSafeInteger(row.reorderPoint)||row.reorderPoint<0)
      throw Error('Stock snapshot contains an invalid reserved/on-hand balance.');
    if(stocks.has(row.productId))throw Error('Stock snapshot contains duplicate product IDs.');
    stocks.set(row.productId,row);
  }
  const counts=new Map();
  for(const p of products) {
    const sku=String(p?.sku||'').trim().toLowerCase();
    if(sku)counts.set(sku,(counts.get(sku)||0)+1);
  }
  return products.flatMap(p=>{
    const sku=String(p?.sku||'').trim().toLowerCase();
    if(!sku||counts.get(sku)!==1)return []; // Never publish ambiguous legacy SKU.
    const item=safePublicProduct(p,stocks.get(p.productId));
    return item?[item]:[];
  });
}
