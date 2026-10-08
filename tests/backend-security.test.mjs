import test from 'node:test';
import assert from 'node:assert/strict';
import {identityOf,isAdmin,ownedUploadKey,jsonBody,reply} from '../backend/security.mjs';
function request(claims){return {requestContext:{authorizer:{jwt:{claims}}}};}
test('requires a real Cognito subject for admin access',()=>{
  assert.equal(isAdmin(request({'cognito:groups':'["hobbyhub-admin"]'})),false);
  assert.equal(isAdmin(request({sub:'8b96be4b-1aaa-4b93-b3b5-a7b0d45ad73e','cognito:groups':'["hobbyhub-admin"]'})),true);
  assert.equal(isAdmin(request({sub:'8b96be4b-1aaa-4b93-b3b5-a7b0d45ad73e',groups:['customers']})),false);
});
test('supports owner allowlist but not arbitrary users',()=>{
  const env={HOBBYHUB_ALLOWED_ADMIN_SUBS:'owner-123',HOBBYHUB_ADMIN_GROUP:'hobbyhub-admin'};
  assert.equal(isAdmin(request({sub:'owner-123'}),env),true);
  assert.equal(isAdmin(request({sub:'not-owner'}),env),false);
});
test('S3 image keys are isolated to the signed-in uploader',()=>{
  const owner='8b96be4b-1aaa-4b93-b3b5-a7b0d45ad73e';
  const uuid='74a0b8fe-2c51-4bd2-bcd8-cdef6159a6bd';
  assert.equal(ownedUploadKey(owner,`uploads/${owner}/${uuid}.png`),true);
  assert.equal(ownedUploadKey('different-owner',`uploads/${owner}/${uuid}.png`),false);
  assert.equal(ownedUploadKey(owner,`uploads/${owner}/../../products/${uuid}.png`),false);
});
test('accepts only a JSON object, prevents an HTML response from leaking private data',()=>{
  assert.equal(jsonBody({body:'{"sku":"MTG-123"}'}).sku,'MTG-123');
  assert.throws(()=>jsonBody({body:'['}),/Invalid JSON/);
  assert.throws(()=>jsonBody({body:'[1,2]'}),/JSON object/);
  const res=reply(403,{message:'Denied'});
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.statusCode,403);
});
