import {createHash} from 'node:crypto';

/**
 * OFFLINE / READ ONLY: derives a migration review plan from COMPLETE,
 * consistently-read legacy Products/Inventory collections. This module
 * contains NO AWS SDK writes, Stripe calls, or mutable stock operations.
 *
 * A digest helps find source drift but does not provide an atomic cross-table
 * snapshot or authorization to migrate. Repeat the comparison immediately
 * before an independently approved cutover.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROWS=100000;
const MAX_UNITS=10000000;
function idOf(row){
  if(typeof row?.productId!=='string'||!ID.test(row.productId))
    throw Error('Record has missing or invalid immutable productId.');
  return row.productId;
}
function whole(n,label){
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>MAX_UNITS)
    throw Error(label+' must be a verified, nonnegative whole number.');
  return n;
}
function uniqueRows(rows,label){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)
    throw Error(label+' requires a complete bounded source collection.');
  const map=new Map();
  for(const row of rows){
    const id=idOf(row);
    if(map.has(id))throw Error(label+' contains duplicate productId.');
    map.set(id,row);
  }
  return map;
}
function stableRows(rows){
  return rows.map(row=>({
    productId:row.productId,
    sku:row.sku,
    productName:row.productName,
    status:row.status,
    salePrice:row.salePrice,
    published:row.published,
    onHand:row.onHand,
    reorderPoint:row.reorderPoint,
    updatedAt:row.updatedAt,
  })).sort((a,b)=>a.productId.localeCompare(b.productId));
}
function digest(rows) {
  return createHash('sha256').update(JSON.stringify(stableRows(rows))).digest('hex');
}
export function makeStockCutoverReview({products,inventory,productsComplete=false,inventoryComplete=false}={}) {
  if(productsComplete!==true||inventoryComplete!==true)
    throw Error('Both DynamoDB collections must be fully read; partial scans cannot be migrated.');
  const productMap=uniqueRows(products,'Products');
  const inventoryMap=uniqueRows(inventory,'Inventory');
  if(productMap.size!==inventoryMap.size)
    throw Error('Products and Inventory row counts differ. Investigate missing/extra records.');
  const skuCounts=new Map();
  for(const p of productMap.values()){
    if(typeof p.sku!=='string'||!p.sku.trim())throw Error('A Product has missing SKU.');
    const sku=p.sku.trim().toLowerCase();
    skuCounts.set(sku,(skuCounts.get(sku)||0)+1);
  }
  if([...skuCounts.values()].some(n=>n>1))
    throw Error('Duplicate SKUs require review; automatic cutover is blocked.');
  const rows=[];
  for(const [productId,p] of productMap){
    const stock=inventoryMap.get(productId);
    if(!stock)throw Error('Product is missing its Inventory productId record.');
    const onHand=whole(stock.quantityOnHand,'Physical on-hand quantity');
    const reorderPoint=whole(stock.reorderPoint,'Reorder point');
    if(typeof stock.updatedAt!=='string'||!Number.isFinite(Date.parse(stock.updatedAt)))
      throw Error('Inventory record lacks a verified updatedAt timestamp.');
    if(p.productId!==stock.productId)throw Error('Inventory foreign key does not match the Product.');
    if(p.status!=='ACTIVE')throw Error('Only confirmed ACTIVE Products may be included.');
    rows.push({
      productId,sku:p.sku.trim(),productName:String(p.productName||'').trim(),
      status:p.status,salePrice:p.salePrice,published:p.published===true,onHand,reorderPoint,updatedAt:stock.updatedAt
    });
    if(!rows[rows.length-1].productName)throw Error('Product name missing.');
  }
  for(const productId of inventoryMap.keys())if(!productMap.has(productId))
    throw Error('Inventory record is orphaned from Products.');
  const quantityTotal=rows.reduce((sum,r)=>sum+r.onHand,0);
  if(!Number.isSafeInteger(quantityTotal))throw Error('Total stock units are unsafe.');
  const hashed=digest(rows);
  return Object.freeze({
    kind:'stock-v2-review-only',authorizedForWrites:false,approvedForLiveCutover:false,
    productCount:rows.length,inventoryCount:rows.length,quantityTotal,
    sourceFingerprint:hashed,
    publicationApprovedCount:products.filter(p=>p.published===true).length,
    // Proposed opening balances exist strictly in the review output; nothing is written.
    rows:stableRows(rows).map(r=>({
      productId:r.productId,sku:r.sku,sourceUpdatedAt:r.updatedAt,
      proposedOpening:{productId:r.productId,onHand:r.onHand,reserved:0,
        reorderPoint:r.reorderPoint,version:1,published:false}
    }))
  });
}
export function assertStockCutoverStillCurrent(plan,source) {
  if(plan?.kind!=='stock-v2-review-only'||plan.authorizedForWrites!==false)
    throw Error('Invalid read-only cutover review plan.');
  const latest=makeStockCutoverReview(source);
  if(plan.sourceFingerprint!==latest.sourceFingerprint ||
     plan.productCount!==latest.productCount||plan.quantityTotal!==latest.quantityTotal)
    throw Error('Legacy stock changed after the review. Reconcile again before any migration.');
  return {unchanged:true,approvedForMigration:false,productCount:latest.productCount,
    quantityTotal:latest.quantityTotal};
}
export function safeCutoverSummary(plan) {
  if(plan?.kind!=='stock-v2-review-only'||plan.authorizedForWrites!==false)
    throw Error('No trustworthy read-only plan.');
  return {
    productCount:plan.productCount,inventoryCount:plan.inventoryCount,
    quantityTotal:plan.quantityTotal,sourceFingerprint:plan.sourceFingerprint,
    proposedRows:plan.rows.length,approvedForWrites:false,approvedForLiveCutover:false,
    publicationApprovedCount:plan.publicationApprovedCount,
    warning:'Review only. No AWS migration, publication, checkout or stock write authorization.'
  };
}
