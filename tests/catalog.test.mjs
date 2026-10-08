import test from 'node:test';
import assert from 'node:assert/strict';
import {productsFromResponse,sortAndFilterProducts,validateProduct,cartTotal} from '../src/lib/catalog.js';
import {parseCsv} from '../src/lib/csv.js';

test('parses quoted CSV, embedded commas, escaped quotes and CRLF',()=>{
 const rows=parseCsv('sku,productName,category,salePrice,quantityOnHand\r\nM-01,"Goblin, Rebel",Magic: The Gathering,1.5,2\r\nM-02,"""Lightning""",Magic: The Gathering,2,1\r\n');
 assert.equal(rows.length,2);assert.equal(rows[0].productName,'Goblin, Rebel');assert.equal(rows[1].productName,'"Lightning"');
});
test('rejects missing required inventory columns',()=>assert.throws(()=>parseCsv('sku,productName\nX-1,A\n'),/category/));
test('rejects malformed CSV',()=>assert.throws(()=>parseCsv('sku,productName\nx,"bad'),/unclosed/));
test('normalizes public catalog, removes inactive entries',()=>{
 const rows=productsFromResponse({items:[{productName:'A',sku:'A-1',salePrice:2},{productName:'B',sku:'B-1',isactive:false}]});
 assert.equal(rows.length,1);assert.equal(rows[0].salePrice,2);
});
test('sort and category work without mutating original list',()=>{
 const rows=[{productName:'B',sku:'2',category:'Pokémon',salePrice:5},{productName:'A',sku:'1',category:'Magic: The Gathering',salePrice:3}];
 const selected=sortAndFilterProducts(rows,{sort:'price-asc',category:'All'});
 assert.equal(selected[0].sku,'1');assert.equal(rows[0].sku,'2');
});
test('validates SKU and stock',()=>{
 assert.throws(()=>validateProduct({productName:'X',sku:'X-1',category:'Magic',salePrice:2,quantityOnHand:-1}),/Stock/);
 assert.equal(validateProduct({productName:'X',sku:'X-1',category:'Magic',salePrice:2,quantityOnHand:1}).sku,'X-1');
});
test('cart subtotal cannot exceed existing inventory',()=>{
 assert.equal(cartTotal({'M-1':5},[{sku:'M-1',salePrice:2,quantityOnHand:2}]),4);
});
