import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalUSShippingDestination,shippingDestinationHmac,verifyBoundStripeDestination
} from '../backend/stripe-shipping-bind.mjs';

const secret=Buffer.from('offline-only-key-should-be-random-in-real-secrets-manager');
const other=Buffer.from('different-offline-key-should-also-be-kept-private-1234');
const base={
  country:'US',state:'MA',postalCode:'02382',city:'Whitman',
  line1:'123 Example Place',line2:'Suite 4',recipient:'DO_NOT_STORE_CUSTOMER_NAME'
};
test('Stripe snake_case and carrier camelCase refer to same verified destination',()=>{
  const a=shippingDestinationHmac(base,secret);
  const stripe={
    country:'us',state:'ma',postal_code:'02382',city:'  WHITMAN ',
    line1:'  123  example place ',line2:'SUITE 4'
  };
  assert.match(a,/^hmac-v1-[0-9a-f]{64}$/);
  assert.equal(shippingDestinationHmac(stripe,secret),a);
  assert.equal(verifyBoundStripeDestination(stripe,a,secret),true);
  assert.doesNotMatch(a,/Example|Whitman|customer/i);
  assert.equal(Object.hasOwn(canonicalUSShippingDestination(base),'recipient'),false);
});
test('any changed street, city, unit, ZIP, state or HMAC key invalidates quoted delivery address',()=>{
  const digest=shippingDestinationHmac(base,secret);
  for(const [field,changed] of [
    ['line1','123 Different Place'],['line2','Suite 5'],['city','Brockton'],
    ['postalCode','02351'],['state','NH']
  ])assert.equal(verifyBoundStripeDestination({...base,[field]:changed},digest,secret),false);
  assert.equal(verifyBoundStripeDestination(base,digest,other),false);
});
test('rejects invalid destinations, military mail, territories and missing address lines',()=>{
  for(const state of ['PR','GU','AA','AE','AP','',null]){
    assert.throws(()=>shippingDestinationHmac({...base,state},secret),/shipping|50 states/);
  }
  for(const change of [
    {country:'CA'}, {postalCode:'invalid'}, {city:''},{line1:''},
    {line1:'abc\ndef'}, {line1:'a'.repeat(161)}
  ])assert.throws(()=>shippingDestinationHmac({...base,...change},secret),/shipping|ZIP/);
  assert.throws(()=>shippingDestinationHmac(null,secret),/Complete domestic/);
});
test('rejects absent or weak HMAC keys and malformed order digests fail-closed',()=>{
  assert.throws(()=>shippingDestinationHmac(base,Buffer.from('weak')),/32-byte/);
  assert.throws(()=>shippingDestinationHmac(base,'not-a-buffer-even-if-long-enough-123456789'),/32-byte/);
  assert.throws(()=>verifyBoundStripeDestination(base,'hmac-v1-not-a-real-digest',secret),/valid carrier-approved/);
  assert.throws(()=>verifyBoundStripeDestination(base,null,secret),/valid carrier-approved/);
});
test('does not mutate carrier address object while computing destination proof',()=>{
  const original=structuredClone(base);
  shippingDestinationHmac(base,secret);
  assert.deepEqual(base,original);
});
