import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_US_STATES,SHIPPING_METHOD,validateUSShippingAddress,shippingRegion,
  validateShippingRates,quoteDomesticShipping,composePrecheckoutTotals
} from '../backend/shipping-v2.mjs';
import {verifyCheckoutQuote,validateCheckoutIntent,buildReservationTransactions} from '../backend/checkout-v2-core.mjs';

const address={recipient:'Sample Recipient',line1:'123 Example Avenue',line2:'Apartment 4',
  city:'Cambridge',state:'ma',postalCode:'02139-1234',country:'us'};
const testRates={method:'domestic_shipping',country:'US',pickupEnabled:false,
  approved:true,ratesCents:{contiguous:825,alaska:2800,hawaii:2900}};
const req='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';

test('U.S.-only shipping includes 50 states and DC, but never pickup or territories',()=>{
  assert.equal(ALLOWED_US_STATES.length,51);
  assert.equal(new Set(ALLOWED_US_STATES).size,51);
  assert.equal(shippingRegion('MA'),'contiguous');
  assert.equal(shippingRegion('DC'),'contiguous');
  assert.equal(shippingRegion('AK'),'alaska');
  assert.equal(shippingRegion('HI'),'hawaii');
  assert.throws(()=>shippingRegion('PR'),/not supported/);
  assert.equal(SHIPPING_METHOD,'domestic_shipping');
});
test('address validation normalizes domestic destinations without claiming carrier verification',()=>{
  const normalized=validateUSShippingAddress(address);
  assert.deepEqual(normalized,{...address,state:'MA',country:'US'});
  const quote=quoteDomesticShipping(address,testRates);
  assert.equal(quote.shippingCents,825); // TEST fixture, never a published merchant rate
  assert.equal(quote.pickupAvailable,false);
  assert.equal(quote.addressVerified,false);
  assert.equal(quote.carrier,null);
  assert.equal(quote.deliveryEstimate,null);
  assert.deepEqual(quote.destination,{state:'MA',postalCode:'02139-1234'});
  assert.equal('line1' in quote,false);
  assert.equal('recipient' in quote,false);
});
test('international, military and territories are excluded from first-launch rules',()=>{
  const invalid=[
    {...address,country:'CA'}, {...address,country:'GB'},
    {...address,state:'PR'}, {...address,state:'GU'}, {...address,state:'VI'},
    {...address,state:'AS'}, {...address,state:'MP'},
    {...address,state:'AA'}, {...address,state:'AE'}, {...address,state:'AP'},
    {...address,postalCode:'H3Z 2Y7'}, {...address,postalCode:'1234'},
    {...address,line1:'  '}
  ];
  for(const item of invalid)assert.throws(()=>validateUSShippingAddress(item));
  assert.throws(()=>validateUSShippingAddress({...address,deliveryMethod:'pickup'}),/unsupported field/);
  assert.throws(()=>validateUSShippingAddress({...address,pickup:true}),/unsupported field/);
});
test('approved merchant rates must be explicit for all supported regions, never guessed',()=>{
  assert.deepEqual(validateShippingRates(testRates),testRates);
  assert.throws(()=>validateShippingRates(undefined),/not been configured/);
  assert.throws(()=>validateShippingRates({...testRates,approved:false}),/approved/);
  assert.throws(()=>validateShippingRates({...testRates,pickupEnabled:true}),/pickup disabled/);
  assert.throws(()=>validateShippingRates({...testRates,country:'CA'}),/U.S.-only/);
  assert.throws(()=>validateShippingRates({...testRates,ratesCents:{contiguous:825}}),/alaska/);
  assert.throws(()=>validateShippingRates({...testRates,ratesCents:{...testRates.ratesCents,alaska:-1}}),/alaska/);
  assert.throws(()=>validateShippingRates({...testRates,ratesCents:{...testRates.ratesCents,hawaii:8.5}}),/hawaii/);
  assert.equal(quoteDomesticShipping({...address,state:'AK'},testRates).shippingCents,2800);
  assert.equal(quoteDomesticShipping({...address,state:'HI'},testRates).shippingCents,2900);
});
test('precheckout totals include approved shipping but NEVER invent tax or charge total',()=>{
  const intent=validateCheckoutIntent({requestId:req,items:[{productId:'product-01',qty:2}]});
  const prod={productId:'product-01',sku:'MTG-ABC',productName:'Booster',published:true,salePrice:5.99};
  const stock={productId:'product-01',version:2,onHand:4,reserved:0};
  const quote=verifyCheckoutQuote(intent,{productsById:new Map([['product-01',prod]]),
    stockById:new Map([['product-01',stock]]),skuCounts:new Map([['mtg-abc',1]])});
  assert.equal(quote.shippingCents,null);
  const planned=composePrecheckoutTotals(quote,quoteDomesticShipping(address,testRates));
  assert.equal(planned.subtotalCents,1198);
  assert.equal(planned.shippingCents,825);
  assert.equal(planned.preTaxCents,2023);
  assert.equal(planned.taxCents,null);
  assert.equal(planned.totalCents,null);
  assert.equal(planned.checkoutReady,false);
  assert.equal(planned.pickupAvailable,false);
  assert.equal(planned.shippingAddressVerified,false);
  assert.throws(()=>buildReservationTransactions(quote,{orderId:'order-1',now:'2026-10-09T12:00:00Z',
    holdUntil:'2026-10-09T12:30:00Z',stockTable:'S',orderTable:'O'}),/U.S. shipping/);
  const plan=buildReservationTransactions(planned,{orderId:'order-1',now:'2026-10-09T12:00:00Z',
    holdUntil:'2026-10-09T12:30:00Z',stockTable:'S',orderTable:'O'});
  assert.equal(plan.order.shippingCents,825);
  assert.equal(plan.order.totalCents,null);
  assert.equal(plan.order.shippingCountry,'US');
  assert.equal(plan.order.shippingMethod,'domestic_shipping');
});
