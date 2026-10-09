import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogReadinessRows,catalogReadinessSummary} from '../src/lib/catalogReadiness.js';

const packaging={lengthIn:9,widthIn:6,heightIn:1,weightOz:4};
const ready={
  productId:'p-1',sku:'MTG-ABC-001',productName:'Play Booster',
  status:'ACTIVE',isactive:true,published:true,salePrice:5.99,
  stockSource:'stock-v2',stockReported:true,stockVersion:2,
  quantityOnHand:5,stockReserved:1,stockAvailable:4,
  shippingPackage:packaging,imageUrl:'https://example.test/card.png'
};
test('only explicitly published, versioned, in-stock, measured domestic inventory is eligible',()=>{
  const r=catalogReadinessRows([ready])[0];
  assert.equal(r.ready,true);
  assert.deepEqual(r.issues,[]);
  assert.equal(catalogReadinessSummary([r]).eligible,1);
});
test('legacy ACTIVE record does not become public without explicit publication flag',()=>{
  const row=catalogReadinessRows([{...ready,published:undefined,status:'ACTIVE'}])[0];
  assert.equal(row.ready,false);
  assert.ok(row.issues.includes('publication'));
});
test('unknown or non-Stock-V2 stock never becomes automatically sellable',()=>{
  for(const p of [
    {...ready,stockSource:'legacy-readonly'},
    {...ready,stockReported:false},
    {...ready,stockAvailable:0,stockReserved:5},
    {...ready,stockAvailable:5},
    {...ready,stockReserved:null},
    {...ready,stockVersion:0}
  ]){
    const r=catalogReadinessRows([p])[0];
    assert.equal(r.ready,false);
    assert.ok(r.issues.includes('stock'));
  }
});
test('browser-local packaging cannot count as persisted backend shipping metadata',()=>{
  for(const p of [{...ready,shippingPackage:null},{...ready,localPackageOnly:true},
    {...ready,shippingPackage:{...packaging,weightOz:'4'}}]){
    const r=catalogReadinessRows([p])[0];
    assert.ok(r.issues.includes('packaging'));
  }
});
test('legacy duplicate SKUs are blocked across all records, even if one is unpublished',()=>{
  const rows=catalogReadinessRows([
    {...ready,published:true},
    {...ready,productId:'p-2',sku:'mtg-abc-001',published:false}
  ]);
  assert.equal(rows[0].ready,false);
  assert.ok(rows[0].issues.includes('duplicate'));
  assert.ok(rows[1].issues.includes('duplicate'));
  assert.ok(rows[1].issues.includes('publication'));
});
test('unverified price and incomplete identity block public listing',()=>{
  const cases=[
    [{...ready,productId:''},'identity'],
    [{...ready,productName:''},'name'],
    [{...ready,salePrice:0},'price'],
    [{...ready,salePrice:5.999},'price'],
    [{...ready,salePrice:undefined},'price'],
    [{...ready,status:'ARCHIVED'},'inactive']
  ];
  for(const [p,issue] of cases)
    assert.ok(catalogReadinessRows([p])[0].issues.includes(issue));
});
test('summary is advisory and includes no AWS mutation permissions',()=>{
  const rows=catalogReadinessRows([ready,{...ready,productId:'p-2',sku:'PKM-002',published:false,shippingPackage:null}]);
  const s=catalogReadinessSummary(rows);
  assert.deepEqual({...s},{total:2,eligible:1,unpublished:1,stockUnverified:0,
    packagingMissing:1,duplicateSku:0,lackingImages:0,nonMutating:true});
});
