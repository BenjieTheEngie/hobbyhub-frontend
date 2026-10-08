import test from 'node:test';
import assert from 'node:assert/strict';
import {matchImageFiles} from '../src/lib/image-batch.js';
const stock=[{sku:'MTG-A-123'},{sku:'YGO-991'}];
const f=(name,type='image/jpeg',size=1024)=>({name,type,size});
test('matches exact inventory SKUs from image filename without guessing',()=>{
 const matched=matchImageFiles([f('MTG-A-123.jpg'),f('missing.jpg')],stock);
 assert.equal(matched.accepted.length,1);assert.equal(matched.accepted[0].product.sku,'MTG-A-123');assert.equal(matched.rejected.length,1);
});
test('rejects ambiguous duplicates and files over 8MB',()=>{
 const matched=matchImageFiles([f('YGO-991.jpg'),f('YGO-991.jpeg'),f('MTG-A-123.png','image/png',9*1024*1024)],stock);
 assert.equal(matched.accepted.length,1);assert.equal(matched.rejected.length,2);
});
