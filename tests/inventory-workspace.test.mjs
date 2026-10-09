import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySummary,inventorySearch,inventoryAuditCsv,skuCounts,productIssues,recordKey,money} from '../src/lib/inventoryAnalytics.js';
import {normalizeInventoryResponse} from '../src/lib/inventoryStatus.js';

const records=normalizeInventoryResponse({items:[
  {productId:'legacy-one',sku:'MTG-001',productName:'Magic Booster Pack',category:'Magic: The Gathering',salePrice:5.99,createdAt:'2026-04-25T00:00:00Z'},
  {productId:'legacy-two',sku:'mtg-001',productName:'Magic Booster Pack',category:'Magic: The Gathering',salePrice:-5.99,createdAt:'2026-04-25T01:00:00Z'},
  {productId:'legacy-three',sku:'MTG-001',productName:'Magic Booster Pack',category:'Magic: The Gathering',salePrice:0,createdAt:'2026-04-25T02:00:00Z'},
  {productId:'pkm-1',sku:'PKM-0001',productName:'Trainer Box',category:'Pokémon',salePrice:42,quantityOnHand:7,isactive:true,published:false},
]});
test('Legacy identity is retained and unreported stock/publication are unknown, not false or zero',()=>{
  assert.equal(records[0].productId,'legacy-one');
  assert.equal(records[0].stockReported,false);
  assert.equal(records[0].publicationKnown,false);
  assert.equal(records[0].activeStatusKnown,false);
  assert.equal(records[3].stockReported,true);
  assert.equal(records[3].publicationKnown,true);
});
test('Audit counts physical records and unique SKU labels separately',()=>{
  const summary=inventorySummary(records);
  assert.equal(summary.records,4);
  assert.equal(summary.uniqueSkus,2);
  assert.equal(summary.duplicateSkus,1);
  assert.equal(summary.unknownStock,3);
  assert.equal(summary.priceIssues,2);
  assert.equal(summary.review,3);
});
test('Duplicate groups are case-insensitive, but identity is productId',()=>{
  const counts=skuCounts(records);
  assert.equal(counts.get('mtg-001'),3);
  assert.deepEqual(productIssues(records[1],counts).includes('duplicate-sku'),true);
  assert.notEqual(recordKey(records[0]),recordKey(records[1]));
});
test('Zero placeholder and negative price have different quality flags',()=>{
  const counts=skuCounts(records);
  assert.ok(productIssues(records[1],counts).includes('invalid-price'));
  assert.ok(productIssues(records[2],counts).includes('zero-price'));
  assert.equal(records[1].rawSalePrice,-5.99);
  assert.equal(money(-5.99),'Review');
  assert.equal(money(5.99),'$5.99');
});
test('Issue workspaces and exact record searches can isolate affected products',()=>{
  assert.equal(inventorySearch(records,{view:'duplicates'}).length,3);
  assert.equal(inventorySearch(records,{view:'missing-stock'}).length,3);
  assert.equal(inventorySearch(records,{view:'invalid-price'}).length,2);
  assert.deepEqual(inventorySearch(records,{query:'legacy-two'}).map(p=>p.productId),['legacy-two']);
  assert.deepEqual(inventorySearch(records,{category:'Pokémon'}).map(p=>p.productId),['pkm-1']);
  assert.equal(inventorySearch(records,{query:'no match'}).length,0);
});
test('Newer live API archived items can be filtered separately',()=>{
  const list=normalizeInventoryResponse({items:[{productId:'id-1',sku:'X-1',productName:'Item',category:'Accessories',salePrice:1,isactive:false,published:false}]});
  assert.equal(inventorySearch(list,{view:'archived'}).length,1);
  assert.equal(inventorySummary(list).archived,1);
});
test('CSV audit keeps productId distinctions and unknown stock, and is read-only',()=>{
  const csv=inventoryAuditCsv(records);
  assert.ok(csv.startsWith('\uFEFFproductId,sku,'));
  assert.match(csv,/legacy-one,MTG-001/);
  assert.match(csv,/legacy-two,mtg-001/);
  assert.match(csv,/UNKNOWN/);
  assert.match(csv,/duplicate-sku/);
  assert.match(csv,/zero-price/);
});
test('CSV audit escapes product-name formula injection, delimiters and quotes',()=>{
  const list=normalizeInventoryResponse({items:[{productId:'id-1',sku:'F-001',productName:'=SUM(1,2) "bad"',category:'Accessories',salePrice:1}]});
  const csv=inventoryAuditCsv(list);
  assert.ok(csv.includes('"\'=SUM(1,2) ""bad"""'));
});
test('No mutation of source inventory while creating issue views or CSV',()=>{
  const before=JSON.stringify(records);
  inventorySearch(records,{sort:'price-high'});
  inventoryAuditCsv(records);
  inventorySummary(records);
  assert.equal(JSON.stringify(records),before);
});

test('Records with a productId but missing SKU remain visible for reconciliation',()=>{
  const list=normalizeInventoryResponse({items:[{productId:'legacy-orphan',productName:'Unknown item',category:'Accessories',salePrice:1}]});
  assert.equal(list.length,1);
  assert.equal(list[0].sku,'');
  assert.ok(productIssues(list[0],skuCounts(list)).includes('missing-sku'));
  assert.equal(inventorySummary(list).review,1);
});
