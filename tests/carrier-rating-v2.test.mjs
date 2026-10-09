import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatedPackedParcel,prepareCarrierQuoteRequest,parcelsForVerifiedCart,
  usdRateCents,verifiedEasyPostRateOptions,aggregateMultiParcelRates,
  composeCarrierPrecheckout
} from '../backend/carrier-rating-v2.mjs';
import {
  EASYPOST_SHIPMENT_URL,requireTestEasyPostKey,buildEasyPostShipmentBody,requestEasyPostTestRates
} from '../backend/easypost-test-rates.mjs';
import {validateCheckoutIntent,verifyCheckoutQuote,buildReservationTransactions} from '../backend/checkout-v2-core.mjs';

const key='EZTK'+'a'.repeat(54);
const from={recipient:'Demo Merchant',line1:'1 Test Lane',city:'Boston',state:'MA',postalCode:'02110',country:'US'};
const to={recipient:'Demo Receiver',line1:'2 Sample Ave',city:'Seattle',state:'WA',postalCode:'98101',country:'US'};
const parcel={lengthIn:9,widthIn:6,heightIn:2,weightOz:8.5};
const p={productId:'p-01',sku:'MTG-A',productName:'Demo card',published:true,salePrice:3,shippingPackage:parcel};
const intent=validateCheckoutIntent({requestId:'7cf18d40-0a57-4f45-af9f-fb5d478cf5a0',items:[{productId:'p-01',qty:1}]});
const verified=()=>verifyCheckoutQuote(intent,{productsById:new Map([['p-01',p]]),
  stockById:new Map([['p-01',{productId:'p-01',onHand:3,reserved:0,version:1}]]),
  skuCounts:new Map([['mtg-a',1]])});
const sampleRate={id:'rate_a12345678901',mode:'test',carrier:'USPS',service:'GroundAdvantage',
  rate:'4.23',currency:'USD',delivery_days:4};
test('parcels require measured packed weight/dimensions and no invented defaults',()=>{
  assert.deepEqual(validatedPackedParcel(parcel),parcel);
  for(const input of [{...parcel,weightOz:0},{...parcel,weightOz:'8.5'},{...parcel,lengthIn:0.01},{...parcel,lengthIn:49},{weightOz:8}])
    assert.throws(()=>validatedPackedParcel(input),/Packed/);
  assert.deepEqual(prepareCarrierQuoteRequest({origin:from,destination:to,parcel}).parcel,parcel);
  assert.throws(()=>prepareCarrierQuoteRequest({origin:from,destination:{...to,country:'GB'},parcel}),/International/);
  assert.throws(()=>prepareCarrierQuoteRequest({origin:{...from,country:'CA'},destination:to,parcel}),/International/);
});
test('packing requires actual admin-measured product package metadata, not shopper price/weight fields',()=>{
  const packs=parcelsForVerifiedCart(intent,new Map([['p-01',p]]));
  assert.deepEqual(packs,[{productId:'p-01',unit:1,...parcel}]);
  assert.throws(()=>parcelsForVerifiedCart(intent,new Map([['p-01',{...p,shippingPackage:null}]])),/packed parcel/);
  const many=validateCheckoutIntent({requestId:intent.requestId,items:[{productId:'p-01',qty:9}]});
  assert.throws(()=>parcelsForVerifiedCart(many,new Map([['p-01',p]])),/packing review/);
});
test('only USD cents and genuine test-mode carrier IDs are eligible',()=>{
  assert.equal(usdRateCents('4.23'),423);
  for(const price of ['4.2','4.230','-4.23','99999.00','NaN',4.23,'0.00'])
    assert.throws(()=>usdRateCents(price));
  const shipment={mode:'test',rates:[
    {...sampleRate},
    {...sampleRate,id:'rate_d12345678901',carrier:'UPS',service:'Ground',rate:'7.05'},
    {...sampleRate,id:'rate_f12345678901',mode:'production',rate:'1.00'},
    {...sampleRate,id:'rate_b12345678901',carrier:'Unknown Carrier',rate:'2.00'},
    {...sampleRate,id:'rate_a12345678901',rate:'3.00'},
    {...sampleRate,id:'rate_z12345678901',currency:'CAD'},
  ]};
  const rates=verifiedEasyPostRateOptions(shipment);
  assert.equal(rates.length,2);
  assert.deepEqual(rates.map(r=>r.shippingCents),[423,705]);
  assert.equal(rates[0].mode,'test');
  assert.throws(()=>verifiedEasyPostRateOptions({...shipment,mode:'production'}),/Test-mode/);
});
test('test-only EasyPost adapter sends parcel ounces/inches to fixed endpoint without label purchase',async()=>{
  assert.equal(requireTestEasyPostKey(key),key);
  assert.throws(()=>requireTestEasyPostKey('EZAK'+'a'.repeat(54)),/TEST API/);
  const reqBody=buildEasyPostShipmentBody({origin:from,destination:to,parcel});
  assert.deepEqual(reqBody.shipment.parcel,{length:9,width:6,height:2,weight:8.5});
  assert.equal(reqBody.shipment.to_address.country,'US');
  assert.equal(reqBody.shipment.to_address.zip,'98101');
  assert.equal(reqBody.shipment.from_address.street1,'1 Test Lane');
  let calls=0;
  const fetchImpl=async (url,init)=>{
    calls++;
    assert.equal(url,EASYPOST_SHIPMENT_URL);
    assert.equal(init.method,'POST');
    assert.ok(!url.includes('/buy'));
    assert.equal(init.headers.Authorization,'Basic '+Buffer.from(key+':').toString('base64'));
    assert.deepEqual(JSON.parse(init.body),reqBody);
    return {ok:true,json:async()=>({id:'shp_abc123456789',mode:'test',rates:[sampleRate]})};
  };
  const result=await requestEasyPostTestRates({apiKey:key,origin:from,destination:to,parcel,fetchImpl});
  assert.equal(calls,1);
  assert.equal(result.options[0].shippingCents,423);
  assert.equal(result.labelPurchased,false);
  assert.equal(result.rateOnly,true);
});
test('carrier network errors and wrong-mode responses fail closed, without quoting a price',async()=>{
  const base={apiKey:key,origin:from,destination:to,parcel};
  await assert.rejects(()=>requestEasyPostTestRates({...base,fetchImpl:async()=>{throw Error('private auth failure');}}),/unavailable/);
  await assert.rejects(()=>requestEasyPostTestRates({...base,fetchImpl:async()=>({ok:false})}),/declined/);
  await assert.rejects(()=>requestEasyPostTestRates({...base,fetchImpl:async()=>({ok:true,json:async()=>({mode:'production',rates:[sampleRate]})})}),/Test-mode/);
  await assert.rejects(()=>requestEasyPostTestRates({...base,fetchImpl:async()=>({ok:true,json:async()=>({mode:'test',rates:[]})})}),/No verified/);
});
test('combined package quote only sums actual verified provider rates, never estimates',()=>{
  const rates=verifiedEasyPostRateOptions({mode:'test',rates:[sampleRate]});
  const combined=aggregateMultiParcelRates([{productId:'p-01',unit:1,options:rates},{productId:'p-01',unit:2,options:rates}]);
  assert.equal(combined.shippingCents,846);
  assert.equal(combined.parcelCount,2);
  assert.equal(combined.chargeable,false);
  assert.throws(()=>aggregateMultiParcelRates([{options:[]}]),/no carrier rate/);
  assert.throws(()=>aggregateMultiParcelRates([]),/One to eight/);
});
test('carrier-based checkout estimate remains unpaid and lacks tax/final price',()=>{
  const rated=aggregateMultiParcelRates([{productId:'p-01',unit:1,
    options:verifiedEasyPostRateOptions({mode:'test',rates:[sampleRate]})}]);
  const estimate=composeCarrierPrecheckout(verified(),rated,to);
  assert.equal(estimate.shippingCents,423);
  assert.equal(estimate.subtotalCents,300);
  assert.equal(estimate.preTaxCents,723);
  assert.equal(estimate.rateMode,'test');
  assert.equal(estimate.carrierRateConfirmedForPayment,false);
  assert.equal(estimate.checkoutReady,false);
  assert.equal(estimate.totalCents,null);
  assert.equal(estimate.taxCents,null);
  assert.throws(()=>buildReservationTransactions(estimate,{
    stockTable:'TEST-STOCK',orderTable:'TEST-ORDERS',orderId:'order-001',
    now:'2026-10-09T10:00:00Z',holdUntil:'2026-10-09T10:30:00Z'
  }),/Carrier TEST quotes/);
  assert.throws(()=>composeCarrierPrecheckout(verified(),{...rated,mode:'production'},to),/test-mode/);
});
