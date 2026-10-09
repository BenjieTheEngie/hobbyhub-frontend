import test from 'node:test';
import assert from 'node:assert/strict';
import {productIssues,inventorySummary,inventoryAuditCsv,skuCounts} from '../src/lib/inventoryAnalytics.js';
const v2={productId:'p1',sku:'MTG-1',productName:'Example sealed pack',category:'Cards',salePrice:5,
  stockReported:true,stockSource:'stock-v2',quantityOnHand:15,stockReserved:13,
  stockAvailable:2,reorderPoint:5,isactive:true,published:false};
test('reorder warning uses available stock, not the larger physical on-hand count',()=>{
  const issues=productIssues(v2,skuCounts([v2]));
  assert.ok(issues.includes('low-stock'));
  assert.equal(inventorySummary([v2]).lowStock,1);
  assert.equal(productIssues({...v2,stockAvailable:10},skuCounts([v2])).includes('low-stock'),false);
});
test('legacy count can be checked but reserved quantity stays unknown',()=>{
  const legacy={...v2,stockSource:'legacy',quantityOnHand:15,stockAvailable:undefined,stockReserved:undefined};
  assert.equal(productIssues(legacy,skuCounts([legacy])).includes('low-stock'),false);
  const csv=inventoryAuditCsv([legacy]);
  assert.match(csv,/stockReserved,stockAvailable,stockReported/);
  assert.ok(csv.includes(',UNKNOWN,UNKNOWN,true'));
});
test('unavailable or corrupted V2 stock remains unknown in warnings and audit CSV',()=>{
  for(const unavailable of [
    {...v2,stockReported:false,quantityOnHand:null,stockAvailable:null,stockReserved:null},
    {...v2,stockAvailable:null},
    {...v2,stockAvailable:-1}
  ]){
    const warnings=productIssues(unavailable,skuCounts([unavailable]));
    assert.ok(warnings.includes('unknown-stock'));
    assert.equal(warnings.includes('low-stock'),false);
  }
  const csv=inventoryAuditCsv([{...v2,stockReported:false,quantityOnHand:null}]);
  assert.ok(csv.includes('UNKNOWN,UNKNOWN,UNKNOWN,false'));
});
