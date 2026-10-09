import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateShippingProfileDraft,readShippingProfile,readShippingProfileList,
  draftProfileTransactionPlan,attachMeasuredDraftProfilesForSandbox
} from '../backend/shipping-profiles-v2-logic.mjs';
import {parcelsForVerifiedCart} from '../backend/carrier-rating-v2.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const profile={lengthIn:9,widthIn:6,heightIn:1,weightOz:5.5};
const input={requestId,expectedVersion:0,shippingPackage:profile,note:'Rigid mailer with protection'};
const context={profileTable:'TEST-PROFILES',auditTable:'TEST-AUDIT',
  actorId:'admin-sub-123',now:'2026-10-09T19:00:00Z'};
test('draft profiles require all measured inches/ounces and refuse publication/payment controls',()=>{
  const data=validateShippingProfileDraft(input);
  assert.deepEqual(data.shippingPackage,profile);
  assert.equal(data.shippingMode,'domestic_shipping');
  for(const value of [
    {...input,shippingPackage:null},{...input,shippingPackage:{...profile,weightOz:0}},
    {...input,shippingPackage:{...profile,lengthIn:2.23}},
    {...input,requestId:'not-uuid'}, {...input,expectedVersion:-1},
    {...input,published:true},{...input,checkoutReady:true},
    {...input,shippingMode:'local_pickup'},{...input,note:'bad\nline'}
  ])assert.throws(()=>validateShippingProfileDraft(value));
});
test('new profile is conditional Put, with unique audit and no permitted live checkout',()=>{
  const plan=draftProfileTransactionPlan('p-001',input,context);
  assert.equal(plan.kind,'shipping-profile-draft-only');
  assert.equal(plan.executable,false);
  assert.equal(plan.profile.status,'DRAFT');
  assert.equal(plan.profile.verifiedForLiveCheckout,false);
  assert.equal(plan.profile.version,1);
  assert.equal(plan.transactItems[0].Put.ConditionExpression,'attribute_not_exists(productId)');
  assert.deepEqual(plan.transactItems[0].Put.Item.shippingPackage,profile);
  assert.equal(plan.transactItems[1].Put.Item.requestId,requestId);
  assert.equal(plan.transactItems[1].Put.Item.note,'Rigid mailer with protection');
  assert.equal(plan.transactItems[1].Put.ConditionExpression,'attribute_not_exists(requestId)');
});
test('updated profile requires exact version, audited request and explicitly remains DRAFT',()=>{
  const plan=draftProfileTransactionPlan('p-001',{...input,expectedVersion:7},context);
  const command=plan.transactItems[0].Update;
  assert.equal(command.TableName,'TEST-PROFILES');
  assert.deepEqual(command.Key,{productId:'p-001'});
  assert.equal(command.ExpressionAttributeValues[':expected'],7);
  assert.equal(command.ExpressionAttributeValues[':no'],false);
  assert.match(command.ConditionExpression,/#version = :expected/);
  assert.equal(plan.profile.version,8);
});
test('stored profile validation fails on malformed records, duplicate IDs and live-approved status',()=>{
  const valid={...draftProfileTransactionPlan('p-001',input,context).profile};
  assert.equal(readShippingProfile(valid).shippingPackage.weightOz,5.5);
  assert.throws(()=>readShippingProfile({...valid,verifiedForLiveCheckout:true}),/verified draft/);
  assert.throws(()=>readShippingProfile({...valid,status:'PUBLISHED'}),/verified draft/);
  assert.throws(()=>readShippingProfile({...valid,shippingPackage:{...profile,weightOz:-1}}),/Packed/);
  assert.throws(()=>readShippingProfileList([valid,valid]),/Duplicate/);
  assert.deepEqual(readShippingProfileList([]),[]);
});
test('shipping profiles attach to a productId in a TEST packing map without mutating Products',()=>{
  const product={productId:'p-001',sku:'MTG-001',productName:'Booster',published:true,salePrice:5};
  const source=new Map([['p-001',product]]);
  const row=draftProfileTransactionPlan('p-001',input,context).profile;
  const linked=attachMeasuredDraftProfilesForSandbox(source,[row]);
  assert.equal(linked.get('p-001').shippingPackage.weightOz,5.5);
  assert.equal(linked.get('p-001').verifiedForLiveCheckout,false);
  assert.equal(source.get('p-001').shippingPackage,undefined);
  const parcels=parcelsForVerifiedCart({items:[{productId:'p-001',qty:2}]},linked);
  assert.equal(parcels.length,2);
  assert.deepEqual(parcels[0].lengthIn,9);
  assert.throws(()=>attachMeasuredDraftProfilesForSandbox(source,[{...row,productId:'wrong'}]),/unknown productId/);
});
test('profile writes cannot target identical AWS tables or unknown product IDs',()=>{
  assert.throws(()=>draftProfileTransactionPlan('bad id',input,context),/productId/);
  assert.throws(()=>draftProfileTransactionPlan('p-001',input,{...context,auditTable:'TEST-PROFILES'}),/Distinct/);
  assert.throws(()=>draftProfileTransactionPlan('p-001',input,{...context,actorId:''}),/admin actor/);
});
