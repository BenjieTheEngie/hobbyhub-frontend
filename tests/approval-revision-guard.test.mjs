import test from 'node:test';import assert from 'node:assert/strict';import {approvalRevisionGuard} from '../backend/approval-revision-guard.mjs';
test('new approval starts revision one',()=>assert.deepEqual(approvalRevisionGuard(null,0),{allowed:true,nextRevision:1}));
test('stale writes are rejected',()=>assert.equal(approvalRevisionGuard({revision:3},2).allowed,false));
test('matching revisions advance',()=>assert.equal(approvalRevisionGuard({revision:3},3).nextRevision,4));
