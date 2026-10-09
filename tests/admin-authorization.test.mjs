import test from 'node:test';
import assert from 'node:assert/strict';
import {claimsOf,identityOf,isAdmin,reply,jsonBody} from '../backend/security.mjs';

const settings={HOBBYHUB_ALLOWED_ADMIN_SUBS:'',HOBBYHUB_ADMIN_GROUP:'hobbyhub-admin'};
function event(claims){
  return {requestContext:{authorizer:{jwt:{claims}}}};
}
const knownSub='bfc25e8e-f9db-4b8c-b7e7-a0ee2cc83e40';

test('JWT admin access defaults DENY when no groups or explicit allowlist exist',()=>{
  for(const claims of [{},{sub:knownSub},{sub:knownSub,'cognito:groups':[]},{sub:knownSub,groups:'users'}, {sub:knownSub,groups:'hobbyhub-admin-similar'}]){
    assert.equal(isAdmin(event(claims),settings),false);
  }
  assert.equal(isAdmin({},settings),false);
  assert.equal(identityOf(event({sub:knownSub})),knownSub);
});
test('only exact named Cognito group, array or valid JSON array grants admin',()=>{
  const variations=[
    {sub:knownSub,'cognito:groups':['hobbyhub-admin']},
    {sub:knownSub,'cognito:groups':'hobbyhub-admin'},
    {sub:knownSub,'cognito:groups':'["other","hobbyhub-admin"]'},
    {sub:knownSub,groups:'users,hobbyhub-admin'}
  ];
  for(const claims of variations)assert.equal(isAdmin(event(claims),settings),true);
  assert.equal(isAdmin(event({sub:knownSub,groups:'other-group'}),settings),false);
  assert.equal(isAdmin(event({groups:'hobbyhub-admin'}),settings),false);
});
test('explicit authorized subject applies only to exact matching subject',()=>{
  const env={...settings,HOBBYHUB_ALLOWED_ADMIN_SUBS:knownSub};
  assert.equal(isAdmin(event({sub:knownSub}),env),true);
  assert.equal(isAdmin(event({sub:'some-other-user'}),env),false);
  assert.equal(isAdmin(event({sub:knownSub+'x'}),env),false);
});
test('claim source must be JWT authorizer context, not request headers/body',()=>{
  const forged={
    requestContext:{authorizer:{jwt:{claims:{sub:knownSub}}}},
    headers:{'cognito:groups':'hobbyhub-admin'},
    body:JSON.stringify({groups:'hobbyhub-admin'})
  };
  assert.equal(isAdmin(forged,settings),false);
  assert.deepEqual(claimsOf({headers:{Authorization:'Bearer fake'}}),{});
});
test('API reply defaults to no-store and allowed origin only, not wildcard CORS',()=>{
  const r=reply(403,{message:'Access denied'});
  assert.equal(r.statusCode,403);
  assert.equal(r.headers['Cache-Control'],'no-store');
  assert.equal(r.headers['Access-Control-Allow-Origin'],'https://hobbyhub.company');
  assert.equal(r.headers.Vary,'Origin');
});
test('malformed payloads never become valid write requests',()=>{
  assert.throws(()=>jsonBody({body:'{invalid json'}),/Invalid JSON/);
  assert.throws(()=>jsonBody({body:'[1,2]'}),/Expected a JSON object/);
  assert.deepEqual(jsonBody({body:'{}'}),{});
});
