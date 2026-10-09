import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalPackageDraft,readSavedPackages,savePackageDrafts,withLocalPackaging} from '../src/lib/localPackaging.js';
import {packagingWorksheetCsv,packagingReadiness} from '../src/lib/packagingWorksheet.js';

const a={productId:'card-001',sku:'MTG-DUP',productName:'Card A'};
const b={productId:'card-002',sku:'MTG-DUP',productName:'Card B'};
const draft=()=>validateLocalPackageDraft({lengthIn:'9.5',widthIn:'6',heightIn:'0.5',weightOz:'3.2',note:'Bubble mailer'});
test('validates merchant-measured quantities with one decimal and no fabricated defaults',()=>{
  const x=draft();
  assert.deepEqual(x.shippingPackage,{lengthIn:9.5,widthIn:6,heightIn:0.5,weightOz:3.2});
  assert.equal(x.note,'Bubble mailer');
  for(const d of [
    {lengthIn:'0',widthIn:'6',heightIn:'1',weightOz:'2'},
    {lengthIn:'9',widthIn:'6',heightIn:'1',weightOz:'3.333'},
    {lengthIn:'49',widthIn:'6',heightIn:'1',weightOz:'2'},
    {lengthIn:'9',widthIn:'6',heightIn:'1',weightOz:'1121'},
    {lengthIn:'9',widthIn:'6',heightIn:'1',weightOz:''}
  ])assert.throws(()=>validateLocalPackageDraft(d));
});
test('local records are versioned and validated by immutable productId',()=>{
  const records={'card-001':draft(),'card-002':draft()};
  const saved=savePackageDrafts(records);
  const recovered=readSavedPackages(saved);
  assert.equal(recovered['card-001'].shippingPackage.weightOz,3.2);
  assert.equal(recovered['card-002'].note,'Bubble mailer');
  assert.deepEqual(readSavedPackages('garbage'),{});
  assert.deepEqual(readSavedPackages('{}'),{});
  assert.throws(()=>savePackageDrafts({'not a valid id':draft()}),/Invalid product identity/);
});
test('duplicate SKUs remain distinct while browser-only dimensions export with correct productId',()=>{
  const drafts={'card-002':draft()};
  const items=withLocalPackaging([a,b],drafts);
  assert.deepEqual(packagingReadiness(items),{total:2,ready:1,missing:1,ambiguous:0});
  assert.equal(items[1].localPackageOnly,true);
  assert.equal(items[0].shippingPackage,undefined);
  const csv=packagingWorksheetCsv(items);
  assert.match(csv,/card-001,MTG-DUP/);
  assert.match(csv,/card-002,MTG-DUP/);
  assert.match(csv,/9.5,6,0.5,3.2,Bubble mailer/);
  assert.ok(csv.includes(',,,,,'));
});
test('server-provided measurements win over local browser drafts',()=>{
  const server={...a,shippingPackage:{lengthIn:8,widthIn:5,heightIn:1,weightOz:2}};
  const result=withLocalPackaging([server],{'card-001':draft()});
  assert.equal(result[0].shippingPackage.lengthIn,8);
  assert.equal(result[0].localPackageOnly,undefined);
});
test('browser-only records never mutate authenticated AWS products',()=>{
  const before=JSON.stringify([a,b]);
  const items=withLocalPackaging([a,b],{'card-001':draft()});
  assert.equal(JSON.stringify([a,b]),before);
  assert.equal(items[0].shippingPackage.weightOz,3.2);
});
