import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationFingerprint} from '../backend/publication-approvals.mjs';
import {
  catalogAdminReview,validateApprovalIntent,planApprovalMutation,samePriorApprovalAudit
} from '../backend/catalog-admin-logic.mjs';
import {
  normalizeCatalogApprovalReview,getCatalogApprovals,changeCatalogApproval
} from '../src/lib/catalogApprovalClient.js';

const id='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const product={productId:'p-001',sku:'MTG-ONE',productName:'Sealed booster',
  status:'ACTIVE',salePrice:5.99,category:'Magic: The Gathering'};
const second={productId:'p-002',sku:'GAME-ONE',productName:'Retro game',
  status:'ACTIVE',salePrice:39,category:'Video Games'};
const fp=publicationFingerprint(product);
const approved={productId:'p-001',revision:1,approved:true,fingerprint:fp,approvedAt:'2026-10-09T18:00:00Z'};

test('admin catalog review lists only safe public product metadata and catches stale publication',()=>{
  const rows=catalogAdminReview([product,second],[approved]);
  assert.equal(rows[0].approved,true);
  assert.equal(rows[0].canApprove,true);
  assert.equal(rows[0].approvalRevision,1);
  assert.equal(rows[1].approved,false);
  assert.equal(rows[1].approvalRevision,0);
  assert.equal('costPrice' in rows[0],false);
  const changed=catalogAdminReview([{...product,salePrice:6},second],[approved]);
  assert.equal(changed[0].needsReview,true);
  assert.equal(changed[0].approved,false);
});
test('admin catalog review rejects duplicates even if product was previously approved',()=>{
  const duplicate={...second,sku:'mtg-one'};
  const rows=catalogAdminReview([product,duplicate],[approved]);
  assert.equal(rows[0].duplicateSku,true);
  assert.equal(rows[0].approved,false);
  assert.equal(rows[0].canApprove,false);
  assert.throws(()=>catalogAdminReview([product,product],[]),/Duplicate/);
});
test('approval intent validates unique UUID, exact fingerprint, revision, and rejects arbitrary prices',()=>{
  const input={requestId:id,expectedRevision:0,expectedFingerprint:fp};
  assert.deepEqual(validateApprovalIntent(input,'approve'),{action:'approve',...input});
  assert.throws(()=>validateApprovalIntent({...input,salePrice:1},'approve'),/unsupported/);
  assert.throws(()=>validateApprovalIntent({...input,expectedRevision:-1},'approve'),/revision/);
  assert.throws(()=>validateApprovalIntent({...input,expectedFingerprint:'bad'},'approve'),/fingerprint/);
  assert.throws(()=>validateApprovalIntent({requestId:'bad',expectedRevision:0},'revoke'),/idempotency/);
  assert.deepEqual(validateApprovalIntent({requestId:id,expectedRevision:1},'revoke'),{
    action:'revoke',requestId:id,expectedRevision:1});
});
test('new approval plans atomic condition-on-missing plus immutable idempotency audit',()=>{
  const intent=validateApprovalIntent({requestId:id,expectedRevision:0,expectedFingerprint:fp},'approve');
  const plan=planApprovalMutation({intent,product,actorId:'admin-1',
    now:'2026-10-09T19:00:00Z',approvalTable:'APPROVALS',auditTable:'AUDIT'});
  assert.equal(plan.record.approved,true);
  assert.equal(plan.record.revision,1);
  assert.equal(plan.record.fingerprint,fp);
  assert.equal(plan.transactItems[0].Put.ConditionExpression,'attribute_not_exists(productId)');
  assert.equal(plan.transactItems[1].Put.ConditionExpression,'attribute_not_exists(requestId)');
  assert.equal(plan.audit.operation,'catalog-approve');
  assert.equal(samePriorApprovalAudit(plan.audit,'p-001',intent),true);
  assert.equal(samePriorApprovalAudit(plan.audit,'p-002',intent),false);
});
test('revoke plans version-locked conditional put and does not retain an approval fingerprint',()=>{
  const intent=validateApprovalIntent({requestId:id,expectedRevision:1},'revoke');
  const plan=planApprovalMutation({intent,product,prior:approved,actorId:'admin-1',
    now:'2026-10-09T19:00:00Z',approvalTable:'APPROVALS',auditTable:'AUDIT'});
  assert.equal(plan.record.approved,false);
  assert.equal(plan.record.revision,2);
  assert.equal('fingerprint' in plan.record,false);
  assert.equal(plan.transactItems[0].Put.ExpressionAttributeValues[':expected'],1);
  assert.equal(samePriorApprovalAudit(plan.audit,'p-001',intent),true);
  assert.throws(()=>planApprovalMutation({intent,product,prior:{...approved,revision:2},
    actorId:'admin-1',now:'2026-10-09T19:00:00Z',approvalTable:'APPROVALS',
    auditTable:'AUDIT'}),/changed/);
});
test('changed product blocks approval at server even with valid original fingerprint',()=>{
  const intent=validateApprovalIntent({requestId:id,expectedRevision:0,expectedFingerprint:fp},'approve');
  assert.throws(()=>planApprovalMutation({intent,product:{...product,salePrice:4.99},
    actorId:'admin-1',now:'2026-10-09T19:00:00Z',
    approvalTable:'APPROVALS',auditTable:'AUDIT'}),/changed since review/);
});
test('browser rejects forged admin review and never performs writes without a verified response',async()=>{
  const review={productId:'p-001',sku:'MTG-ONE',productName:'Sealed booster',
    salePrice:5.99,status:'ACTIVE',fingerprint:fp,duplicateSku:false,
    approvalRevision:0,approved:false,canApprove:true,needsReview:false};
  const response=normalizeCatalogApprovalReview({mode:'admin-review-only',writesEnabled:false,items:[review]});
  assert.equal(response.writesEnabled,false);
  assert.equal(response.items[0].approvalRevision,0);
  assert.throws(()=>normalizeCatalogApprovalReview({items:[review]}),/verified/);
  assert.throws(()=>normalizeCatalogApprovalReview({mode:'admin-review-only',items:[review,review]}),/duplicate|invalid product/);
  const loaded=await getCatalogApprovals('https://sandbox.example','jwt',async(url,init)=>{
    assert.equal(init.method,'GET');
    assert.equal(init.cache,'no-store');
    return {ok:true,json:async()=>({mode:'admin-review-only',writesEnabled:false,items:[review]})};
  });
  assert.equal(loaded.items[0].productId,'p-001');
  const confirmed=await changeCatalogApproval('https://sandbox.example','jwt',review,'approve',
    async(url,init)=>{
      assert.equal(init.method,'POST');
      assert.ok(url.endsWith('/p-001/approve'));
      const sent=JSON.parse(init.body);
      assert.equal(sent.requestId,id);
      assert.equal(sent.expectedFingerprint,fp);
      assert.equal(sent.expectedRevision,0);
      assert.equal('salePrice' in sent,false);
      return {ok:true,json:async()=>({applied:true,productId:'p-001',revision:1})};
    },id);
  assert.equal(confirmed.revision,1);
  await assert.rejects(()=>changeCatalogApproval('https://sandbox.example','jwt',review,'approve',
    async()=>({ok:true,json:async()=>({applied:true,productId:'p-001',revision:99})}),id),/exact approval version/);
});
