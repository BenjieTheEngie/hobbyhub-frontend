import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePackagingCsv,preparePackagingCsvImport} from '../src/lib/packagingWorksheetImport.js';
import {packagingWorksheetCsv} from '../src/lib/packagingWorksheet.js';
import {withLocalPackaging,readSavedPackages} from '../src/lib/localPackaging.js';

const products=[
  {productId:'id-one',sku:'MTG-001',productName:'First, booster',category:'Trading cards'},
  {productId:'id-two',sku:'MTG-001',productName:'Second booster',category:'Trading cards'}
];
const measured={
  ...products[0],shippingPackage:{lengthIn:9,widthIn:6,heightIn:1.5,weightOz:3.2},
  packagingNotes:'Sleeve, toploader and padded mailer'
};
test('CSV export/import keeps quoted commas and correctly measured productId with duplicate SKUs',()=>{
  const csv=packagingWorksheetCsv([measured,products[1]]);
  const rows=parsePackagingCsv(csv);
  assert.equal(rows.length,2);
  assert.equal(rows[0].productName,'First, booster');
  assert.equal(rows[0].packagingNotes,'Sleeve, toploader and padded mailer');
  const result=preparePackagingCsvImport(csv,products);
  assert.equal(result.importedCount,1);
  assert.equal(result.skippedEmpty,1);
  assert.equal(result.awsWrites,false);
  assert.equal(result.next['id-one'].shippingPackage.weightOz,3.2);
  assert.equal('id-two' in result.next,false);
  const restored=readSavedPackages(result.serialized);
  const packaged=withLocalPackaging(products,restored);
  assert.equal(packaged[0].localPackageOnly,true);
  assert.equal(packaged[0].shippingPackage.lengthIn,9);
  assert.equal(packaged[1].shippingPackage,undefined);
});
test('quoted CSV fields preserve escaped quotes without premature row splitting',()=>{
  const csv=packagingWorksheetCsv([{...measured,productName:'One "special", boxed edition',packagingNotes:'Put in "safe" box'}]);
  const rows=parsePackagingCsv(csv);
  assert.equal(rows[0].productName,'One "special", boxed edition');
  assert.equal(rows[0].packagingNotes,'Put in "safe" box');
});
test('unknown product IDs, missing fields, repeated records and SKU mismatches fail without partial import',()=>{
  const csv=packagingWorksheetCsv([measured]);
  assert.throws(()=>preparePackagingCsvImport(csv,[products[1]]),/unknown productId/);
  assert.throws(()=>preparePackagingCsvImport(csv,[{...products[0],sku:'OTHER'}]),/SKU differs/);
  assert.throws(()=>preparePackagingCsvImport(packagingWorksheetCsv([measured,measured]),products),/repeated product IDs/);
  assert.throws(()=>preparePackagingCsvImport(csv,[products[0],products[0]]),/duplicate product identities/);
  assert.throws(()=>preparePackagingCsvImport(csv,[{...products[0],shippingPackage:measured.shippingPackage}]),/authoritative/);
  const cols=csv.trim().split('\r\n');
  cols[1]=cols[1].replace('9,6,1.5,3.2','9,,1.5,3.2');
  assert.throws(()=>preparePackagingCsvImport(cols.join('\r\n'),products),/all four/);
});
test('untrusted or broken CSV syntax is rejected before local storage writes',()=>{
  const csv=packagingWorksheetCsv([measured]);
  const bad=[
    '',
    'sku,productId\n',
    csv.replace('productId,sku','sku,productId'),
    csv.replace('"First, booster"','"First, booster'),
    csv.replace('"First, booster"','"First, booster"x'),
    csv.replace('Trading cards','Trading,cards')
  ];
  for(const text of bad)assert.throws(()=>parsePackagingCsv(text));
  assert.throws(()=>parsePackagingCsv('a'.repeat(400001)),/400 KB/);
});
test('invalid numeric data and partial rows never overwrite browser package records',()=>{
  const csv=packagingWorksheetCsv([measured]);
  const existing={'id-two':{
    shippingPackage:{lengthIn:8,widthIn:5,heightIn:1,weightOz:2},note:'Existing',recordedAt:'2026-10-09T18:00:00Z'
  }};
  const before=JSON.stringify(existing);
  const bad=csv.replace('9,6,1.5,3.2','9,6,1.5,3.999');
  assert.throws(()=>preparePackagingCsvImport(bad,products,existing),/at most one decimal/);
  assert.equal(JSON.stringify(existing),before);
  const imported=preparePackagingCsvImport(csv,products,existing);
  assert.equal(imported.next['id-two'].note,'Existing');
  assert.equal(imported.importedCount,1);
});
