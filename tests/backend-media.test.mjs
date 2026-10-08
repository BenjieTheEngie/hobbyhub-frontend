import test from 'node:test';
import assert from 'node:assert/strict';
import {publicImageKey,checkImageSignature,normalizeScrydexVision} from '../backend/media-helpers.mjs';
test('distinguishes actual PNG JPEG and WebP bytes from spoofed file headers',()=>{
  assert.equal(checkImageSignature('image/png',Uint8Array.from([137,80,78,71,13,10,26,10])),true);
  assert.equal(checkImageSignature('image/jpeg',Uint8Array.from([255,216,255,219])),true);
  assert.equal(checkImageSignature('image/webp',Buffer.from('RIFFabcdWEBP','ascii')),true);
  assert.equal(checkImageSignature('image/png',Buffer.from('<svg onload=','utf8')),false);
  assert.equal(checkImageSignature('text/html',Buffer.from('<html>')),false);
});
test('only a staged object key can be transformed into a published CDN path',()=>{
  assert.equal(publicImageKey('uploads/sub-id/uuid.jpg'),'sub-id/uuid.jpg');
  assert.throws(()=>publicImageKey('private/sub-id/key.jpg'));
});
test('vision provider mapping gives human-review flag with game and image',()=>{
  const response={data:{matches:[{score:0.95,card:{name:'Test Pokémon',id:'set1-32',images:[{type:'front',large:'https://example.com/art.png'}],expansion:{id:'set1'},number:'32'}}]}};
  const card=normalizeScrydexVision(response,'Pokémon');
  assert.equal(card.match.productName,'Test Pokémon');
  assert.equal(card.match.setCode,'SET1');
  assert.equal(card.requiresHumanReview,true);
  assert.equal(normalizeScrydexVision({data:{matches:[]}},'Pokémon'),null);
});
