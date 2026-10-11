import test from 'node:test';import assert from 'node:assert/strict';import {stockAuditIdempotency} from '../backend/stock-audit-idempotency.mjs';
const r={requestId:'r1',productId:'a',operation:'adjust',delta:1,expectedVersion:1,reason:'restock'};
test('identical request is a replay',()=>assert.equal(stockAuditIdempotency(r,{...r}).action,'REPLAY'));
test('request reuse for another product is conflict',()=>assert.equal(stockAuditIdempotency(r,{...r,productId:'b'}).action,'CONFLICT'));
test('new request can create',()=>assert.equal(stockAuditIdempotency(null,r).action,'CREATE'));
