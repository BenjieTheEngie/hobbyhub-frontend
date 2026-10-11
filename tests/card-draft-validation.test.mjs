import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCardDraft} from '../backend/card-draft-validation.mjs';
const base={productId:'card-001',sku:'MTG-SET-001',productName:'Lightning Bolt',
 category:'Magic: The Gathering',setCode:'M11',collectorNumber:'149',
 condition:'NM',finish:'nonfoil',language:'English',salePrice:2.50,quantity:3};
test('card drafts are normalized and never published',()=>{
 const draft=validateCardDraft(base);
 assert.equal(draft.status,'DRAFT');
 assert.equal(draft.published,false);
 assert.equal(draft.quantity,3);
 assert.equal(Object.isFrozen(draft),true);
});
test('card draft rejects unsafe price, quantity and publication attempts',()=>{
 for(const patch of [{salePrice:1.001},{salePrice:0},{quantity:-1},{quantity:2.5},
   {status:'ACTIVE'},{published:true},{imageUrl:'javascript:alert(1)'}])
   assert.throws(()=>validateCardDraft({...base,...patch}));
});
test('card draft requires card-specific metadata and safe identifiers',()=>{
 for(const patch of [{productId:'bad id'},{sku:'x'},{category:'Other'},
  {setCode:''},{collectorNumber:''},{condition:'Mint'},
  {finish:'glitter'},{language:'Unknown'},{productName:'  Bolt'}])
  assert.throws(()=>validateCardDraft({...base,...patch}));
 assert.equal(validateCardDraft({...base,imageUrl:'https://example.com/card.png'}).imageUrl,
 'https://example.com/card.png');
});
