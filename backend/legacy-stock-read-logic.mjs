/**
 * Admin-only read model for the ORIGINAL Inventory table.
 * Intentionally separate from Stock V2: no reserved/available claims and NO
 * write, initialize, migration, publication, checkout, or payment capability.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function legacyStockListFromDynamoRows(rows) {
  if(!Array.isArray(rows))throw Error('Inventory scan must be complete.');
  const found=new Set();
  return rows.map(row=>{
    if(!row || typeof row.productId!=='string' || !ID.test(row.productId) ||
       found.has(row.productId))
      throw Error('Inventory contains a missing or duplicate productId.');
    found.add(row.productId);
    if(!Number.isSafeInteger(row.quantityOnHand)||row.quantityOnHand<0||
       !Number.isSafeInteger(row.reorderPoint)||row.reorderPoint<0)
      throw Error('Inventory contains unverified quantity or reorder point.');
    if(typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))
      throw Error('Inventory contains an invalid update timestamp.');
    return {productId:row.productId,quantityOnHand:row.quantityOnHand,
      reorderPoint:row.reorderPoint,updatedAt:row.updatedAt};
  });
}
export function joinLegacyReadOnlyStock(products,inventory){
  if(!Array.isArray(products)||!Array.isArray(inventory))
    throw Error('Both product and inventory data are required.');
  const byId=new Map();
  for(const row of legacyStockListFromDynamoRows(inventory)){
    byId.set(row.productId,row);
  }
  const result=[];
  const ids=new Set();
  for(const p of products) {
    const id=p?.productId;
    if(typeof id!=='string'||!ID.test(id)||ids.has(id))
      throw Error('Product list has an invalid or duplicate productId.');
    ids.add(id);
    const row=byId.get(id);
    result.push({
      productId:id,productName:String(p.productName||'').trim()||'Unnamed product',
      sku:String(p.sku||'').trim()||'(No SKU)',
      countVerified:Boolean(row),quantityOnHand:row?.quantityOnHand??null,
      reorderPoint:row?.reorderPoint??null,updatedAt:row?.updatedAt??null,
      lowStock:Boolean(row&&row.quantityOnHand<=row.reorderPoint)
    });
  }
  if(inventory.some(x=>!ids.has(x.productId)))
    throw Error('Inventory includes orphaned product IDs; contact administrator before relying on counts.');
  return result;
}
export function legacyStockSummary(joined) {
  if(!Array.isArray(joined))throw Error('Joined inventory list required.');
  return {
    verified:joined.filter(x=>x.countVerified).length,
    unknown:joined.filter(x=>!x.countVerified).length,
    total:joined.reduce((n,x)=>n+(x.quantityOnHand??0),0),
    lowStock:joined.filter(x=>x.lowStock).length,
    readOnly:true
  };
}
