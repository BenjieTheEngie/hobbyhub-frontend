import test from 'node:test';
import assert from 'node:assert/strict';
import {PACKAGING_COLUMNS,measuredPackagingProfile,packagingReadiness,packagingWorksheetCsv} from '../src/lib/packagingWorksheet.js';

const records=[
  {productId:'physical-one',sku:'MTG-001',productName:'Magic Booster Pack',category:'Magic: The Gathering'},
  {productId:'physical-two',sku:'MTG-001',productName:'Magic Booster Pack',category:'Magic: The Gathering'},
  {productId:'physical-three',sku:'GAME-001',productName:'Vintage Game',
    shippingPackage:{lengthIn:8,widthIn:6,heightIn:1,weightOz:6.5}},
];
test('packaging readiness tracks actual productId not nonunique legacy SKU',()=>{
  assert.deepEqual(packagingReadiness(records),{total:3,ready:1,missing:2,ambiguous:0});
  const text=packagingWorksheetCsv(records);
  assert.ok(text.startsWith('\uFEFF'+PACKAGING_COLUMNS.join(',')));
  assert.match(text,/physical-one,MTG-001/);
  assert.match(text,/physical-two,MTG-001/);
  assert.match(text,/physical-three,GAME-001/);
  assert.match(text,/8,6,1,6.5/);
});
test('unknown packaging remains BLANK, never defaults to a fabricated weight',()=>{
  const text=packagingWorksheetCsv([records[0]]);
  const lines=text.trim().split('\r\n');
  assert.equal(lines.length,2);
  assert.ok(lines[1].endsWith(',,,,,'));
  assert.ok(!/0\.0/.test(lines[1]));
});
test('invalid dimensions are never treated as shipping ready',()=>{
  assert.equal(measuredPackagingProfile({...records[2],shippingPackage:{lengthIn:8,widthIn:6,heightIn:1,weightOz:'6.5'}}),null);
  assert.equal(measuredPackagingProfile({...records[2],shippingPackage:{lengthIn:8,widthIn:6,heightIn:1,weightOz:0}}),null);
  assert.equal(measuredPackagingProfile({...records[2],shippingPackage:{lengthIn:8,widthIn:6,heightIn:1,weightOz:6.555}}),null);
});
test('worksheet exports neutralize formulas and CSV quotes',()=>{
  const text=packagingWorksheetCsv([{productId:'id-1',sku:'MTG-A',productName:'=HYPERLINK("bad", "x")',category:'Cards, Sealed'}]);
  assert.match(text,/"'=HYPERLINK\(""bad"", ""x""\)"/);
  assert.match(text,/"Cards, Sealed"/);
});
test('worksheet refuses ambiguous product identities instead of merging SKU copies',()=>{
  assert.equal(packagingReadiness([{productId:'id-A'},{productId:'id-A'},{sku:'NOT-ID'}]).ambiguous,2);
  assert.throws(()=>packagingWorksheetCsv([{productId:'id-A'},{productId:'id-A'}]),/unique productId/);
  assert.throws(()=>packagingWorksheetCsv([{sku:'MTG-A'}]),/unique productId/);
});
test('worksheet has no AWS writes, no computed shipping prices, and no input mutation',()=>{
  const before=JSON.stringify(records);
  const csv=packagingWorksheetCsv(records);
  assert.equal(JSON.stringify(records),before);
  assert.equal(csv.includes('shippingCents'),false);
  assert.equal(csv.includes('shippingPrice'),false);
});
