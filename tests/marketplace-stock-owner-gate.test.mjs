import test from 'node:test';import assert from 'node:assert/strict';import {marketplaceStockOwnerGate} from '../backend/marketplace-stock-owner-gate.mjs';
const listing={listingId:'listing1',sellerId:'seller1',status:'ACTIVE'};
test('seller cannot alter another listing stock',()=>assert.equal(marketplaceStockOwnerGate({actorSellerId:'seller2',listing,stock:{productId:'listing1'}}).allowed,false));
test('seller cannot use unrelated stock row',()=>assert.equal(marketplaceStockOwnerGate({actorSellerId:'seller1',listing,stock:{productId:'listing2'}}).allowed,false));
