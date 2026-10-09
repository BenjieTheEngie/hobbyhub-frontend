import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedCatalog,safeSavedCart,reconcileCart,setCartQuantity,shopFilter,shopMoney} from '../src/lib/shop.js';
import {suggestSku,normalizeMagicPrinting,pickPrinting,csvEscape,exportInventoryCsv,importPreview,magicPrintings} from '../src/lib/cardPreparation.js';

const products=[
  {sku:'MTG-MH3-123-N',productName:'Lightning Bolt',category:'Magic: The Gathering',salePrice:2.5,quantityOnHand:2},
  {sku:'PKM-001',productName:'Trainer Box',category:'Pokémon',salePrice:30,quantityOnHand:1},
];

test('catalog requires explicit verified publication state',()=>{
  const loaded=publishedCatalog({items:[
    {...products[0]}, {...products[1],published:true},
    {...products[0],sku:'hidden',published:false},
    {...products[0],sku:'archived',isactive:false},
  ]});
  assert.equal(loaded.length,1);
  assert.deepEqual(loaded.map(p=>p.sku),['PKM-001']);
});
test('catalog rejects malformed response, bad prices and unsafe image URLs',()=>{
  assert.throws(()=>publishedCatalog({message:'Not configured'}),/invalid product list/);
  assert.equal(publishedCatalog([{...products[0],salePrice:-2}]).length,0);
  assert.equal(publishedCatalog([{...products[0],published:true,imageUrl:'javascript:alert(1)'}])[0].imageUrl,'');
});
test('search, categories and price sort all filter independently',()=>{
  const arr=[products[0],products[1]];
  assert.deepEqual(shopFilter(arr,{search:'mh3'}).map(x=>x.sku),['MTG-MH3-123-N']);
  assert.deepEqual(shopFilter(arr,{category:'Pokémon'}).map(x=>x.sku),['PKM-001']);
  assert.deepEqual(shopFilter(arr,{sort:'price-high'}).map(x=>x.sku),['PKM-001','MTG-MH3-123-N']);
  assert.equal(shopMoney(2.5),'$2.50');
});
test('cart storage rejects bad JSON, duplicate SKUs and unreasonable quantities',()=>{
  assert.deepEqual(safeSavedCart('{bad'),[]);
  const result=safeSavedCart(JSON.stringify([
    {sku:'MTG-MH3-123-N',cartQuantity:500}, {sku:'MTG-MH3-123-N',cartQuantity:1}, {sku:'-bad',cartQuantity:2},
  ]));
  assert.deepEqual(result,[{sku:'MTG-MH3-123-N',cartQuantity:99}]);
});
test('cart rehydrates only items actually in the live catalog and caps stock',()=>{
  const result=reconcileCart([{sku:'MTG-MH3-123-N',cartQuantity:20},{sku:'gone',cartQuantity:1}],products);
  assert.equal(result.length,1);
  assert.equal(result[0].cartQuantity,2);
  assert.equal(setCartQuantity(result,'MTG-MH3-123-N',20)[0].cartQuantity,2);
});
test('SKU suggestions distinguish card printings and avoid collisions',()=>{
  const p={productName:'Lightning Bolt',category:'Magic: The Gathering',setCode:'MH3',collectorNumber:'123'};
  assert.equal(suggestSku(p,[],'Nonfoil'),'MTG-MH3-123-N');
  assert.equal(suggestSku(p,products,'Nonfoil'),'MTG-MH3-123-N-2');
  assert.equal(suggestSku(p,products,'Foil'),'MTG-MH3-123-F');
});
test('Magic printing selection uses exact set/collector and leaves prices unset',()=>{
  const p=normalizeMagicPrinting({id:'abc123',name:'Lightning Bolt',set:'mh3',set_name:'Modern Horizons 3',collector_number:'123',image_uris:{normal:'https://cards.scryfall.io/example.jpg'},finishes:['nonfoil','foil']});
  assert.equal(p.setCode,'MH3');
  const selection=pickPrinting(p,products,'Foil');
  assert.equal(selection.sku,'MTG-MH3-123-F');
  assert.equal(selection.setCode,'MH3');
  assert.equal(selection.imageUrl,'https://cards.scryfall.io/example.jpg');
  assert.equal(selection.salePrice,undefined);
});
test('CSV export quotes commas, quotes and linebreaks and preserves headers',()=>{
  const csv=exportInventoryCsv([{sku:'MTG-002',productName:'Dragon, "Queen"\nFoil'}],['sku','productName']);
  assert.match(csv,/"Dragon, ""Queen""/);
  assert.ok(csv.startsWith('\uFEFFsku,productName'));
});
test('CSV preview flags duplicate SKUs and missing prices without uploading',()=>{
  const p=importPreview([{sku:'MTG-MH3-123-N',salePrice:0,published:false},{sku:'MTG-002',salePrice:5,published:true}],products);
  assert.equal(p.total,2);
  assert.equal(p.newCount,1);
  assert.deepEqual(p.duplicateSkus,['MTG-MH3-123-N']);
  assert.deepEqual(p.priceReview,['MTG-MH3-123-N']);
});
test('Magic printings request respects exact printing metadata and API allowlist',async()=>{
  const fetchBefore=globalThis.fetch;
  let count=0;
  try {
    globalThis.fetch=async (url)=>{
      count++;
      if(count===1) {
        assert.match(url,/api.scryfall.com\/cards\/named/);
        return {ok:true,json:async()=>({name:'Lightning Bolt',prints_search_uri:'https://api.scryfall.com/cards/search?q=test'})};
      }
      return {ok:true,json:async()=>({data:[{id:'1',name:'Lightning Bolt',set:'mh3',set_name:'MH3',collector_number:'123'}],has_more:false})};
    };
    const r=await magicPrintings('Lightning Bolt');
    assert.equal(count,2);
    assert.equal(r.items[0].setCode,'MH3');
    assert.equal(r.hasMore,false);
  } finally {globalThis.fetch=fetchBefore;}
});
test('Scryfall prints lookup refuses untrusted API URL',async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>({ok:true,json:async()=>({prints_search_uri:'https://example.org/steal'})});
    await assert.rejects(()=>magicPrintings('Lightning Bolt'),/safe printing lookup/);
  } finally{globalThis.fetch=old;}
});

test('shop rejects inactive legacy products and prices that cannot be charged exactly',()=>{
  const base={...products[0],published:true,status:'ACTIVE'};
  const rows=[
    base,
    {...base,sku:'HIDDEN',status:'INACTIVE'},
    {...base,sku:'BROKEN-PRICE',salePrice:3.999},
    {...base,sku:'EXPENSIVE',salePrice:60000},
    {...base,sku:'VALID-CENTS',salePrice:12.25}
  ];
  assert.deepEqual(publishedCatalog(rows).map(p=>p.sku),['MTG-MH3-123-N','VALID-CENTS']);
});
