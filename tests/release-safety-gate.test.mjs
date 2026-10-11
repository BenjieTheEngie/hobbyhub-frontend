import test from 'node:test';import assert from 'node:assert/strict';import {releaseSafetyGate} from '../backend/release-safety-gate.mjs';
test('passing tests does not imply permission to publish',()=>assert.equal(releaseSafetyGate({catalogVerified:true,inventoryReconciled:true}).publicListingReady,false));
test('live checkout needs distinct authorization',()=>assert.equal(releaseSafetyGate({catalogVerified:true,inventoryReconciled:true,publicationAuthorized:true,carrierIntegrationTested:true,paymentsTested:true,securityReviewed:true}).checkoutReady,false));
