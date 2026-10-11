import test from 'node:test';import assert from 'node:assert/strict';import {approvalFingerprintDrift} from '../backend/approval-fingerprint-drift.mjs';
test('missing approval fails closed',()=>assert.equal(approvalFingerprintDrift({},null).valid,false));
test('changed product metadata is rejected',()=>{const p={productId:'a',sku:'SKU-1',productName:'Bolt',status:'ACTIVE',salePrice:7.5};assert.equal(approvalFingerprintDrift(p,{productId:'a',approved:true,revision:1,approvedAt:'2026-10-10T00:00:00Z',fingerprint:'a'.repeat(64)}).valid,false)});
