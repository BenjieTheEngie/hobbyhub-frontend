import {marketplaceStockOwnerGate} from './marketplace-stock-owner-gate.mjs';
export function sellerStockBoundary(input){const gate=marketplaceStockOwnerGate(input);return {authorized:gate.allowed,reason:gate.reason||null,listingId:gate.allowed?gate.listingId:null};}
