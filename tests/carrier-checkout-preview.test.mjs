import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareVerifiedCarrierCheckoutPreview} from '../backend/carrier-checkout-preview.mjs';
import {buildReservationTransactions} from '../backend/checkout-v2-core.mjs';

const reqId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const origin={recipient:'Test Merchant',line1:'1 Example Street',city:'Boston',state:'MA',postalCode:'02110',country:'US'};
const destination={recipient:'Demo Buyer',line1:'10 Test Road',city:'Burlington',state:'VT',postalCode:'05401',country:'US'};
const packing={lengthIn:10,widthIn:7,heightIn:2,weightOz:7.5};
const base={productId:'physical-one',sku:'MTG-100',productName:'Sealed Booster',published:true,status:'ACTIVE',salePrice:6.5,shippingPackage:packing};
const resultRate={provider:'easypost',mode:'test',rateOnly:true,labelPurchased:false,
  options:[{provider:'easypost',mode:'test',carrier:'USPS',service:'GroundAdvantage',
    rateId:'rate_abcd123456789',shippingCents:489,currency:'usd',deliveryDays:5},
    {provider:'easypost',mode:'test',carrier:'UPS',service:'Ground',
    rateId:'rate_dabc123456789',shippingCents:875,currency:'usd',deliveryDays:4}]};
const cartRequest={requestId:reqId,items:[{productId:'physical-one',qty:1}]};
function inputs({product=base,stock={productId:'physical-one',onHand:5,reserved:0,version:3},
  skuCount=1,quantity=1,shipTo=destination,packed=packing}={}){
  return {
    cartRequest:{...cartRequest,items:[{productId:'physical-one',qty:quantity}]},
    productsById:new Map([['physical-one',{...product,shippingPackage:packed}]]),
    stockById:new Map([['physical-one',stock]]),
    skuCounts:new Map([['mtg-100',skuCount]]),
    origin,destination:shipTo,
  };
}
test('rated checkout derives prices and packed weights from merchant-owned product records',async()=>{
  let count=0;
  const result=await prepareVerifiedCarrierCheckoutPreview({...inputs(),quoteParcel:async query=>{
    count++;
    assert.deepEqual(query.parcel,packing);
    assert.equal(query.origin.state,'MA');
    assert.equal(query.destination.state,'VT');
    return resultRate;
  }});
  assert.equal(count,1);
  assert.equal(result.subtotalCents,650);
  assert.equal(result.shippingCents,489);
  assert.equal(result.preTaxCents,1139);
  assert.equal(result.taxCents,null);
  assert.equal(result.totalCents,null);
  assert.equal(result.chargeable,false);
  assert.equal(result.checkoutReady,false);
  assert.equal(result.carrierPreview.parcelCount,1);
  assert.equal(result.carrierPreview.rateOptions[0].carrier,'USPS');
  assert.equal(result.carrierPreview.labelPurchased,false);
  assert.equal(JSON.stringify(result).includes('1 Example Street'),false);
  assert.equal(JSON.stringify(result).includes('10 Test Road'),false);
  assert.equal(JSON.stringify(result).includes('Demo Buyer'),false);
  assert.throws(()=>buildReservationTransactions(result,{
    stockTable:'TESTSTOCK',orderTable:'TESTORDERS',orderId:'order001',
    now:'2026-10-09T10:00:00Z',holdUntil:'2026-10-09T10:35:00Z'
  }),/Carrier TEST quotes/);
});
test('duplicate SKU, unpublished, insufficient stock and missing packaging block before network',async()=>{
  const cases=[
    inputs({skuCount:2}),
    inputs({product:{...base,published:false}}),
    inputs({product:{...base,status:undefined}}),
    inputs({product:{...base,status:'INACTIVE'}}),
    inputs({stock:{productId:'physical-one',onHand:0,reserved:0,version:3}}),
    inputs({packed:null}),
    inputs({stock:{productId:'physical-one',onHand:5,version:1}}),
  ];
  for(const item of cases){
    let calls=0;
    await assert.rejects(()=>prepareVerifiedCarrierCheckoutPreview({...item,quoteParcel:async()=>{calls++;return resultRate;}}));
    assert.equal(calls,0);
  }
});
test('carrier test quote fails closed if one of several parcels cannot be rated',async()=>{
  let calls=0;
  await assert.rejects(()=>prepareVerifiedCarrierCheckoutPreview({
    ...inputs({quantity:2}),quoteParcel:async()=>{
      calls++;
      return calls===1?resultRate:{...resultRate,options:[]};
    }
  }),/all parcels/);
  assert.equal(calls,2);
});
test('each unit is rated as one actual packed parcel until consolidated packing is verified',async()=>{
  let calls=0;
  const result=await prepareVerifiedCarrierCheckoutPreview({
    ...inputs({quantity:2}),quoteParcel:async()=>{
      calls++;
      return calls===1?resultRate:{
        ...resultRate,options:resultRate.options.map((r,i)=>({
          ...r,rateId:i===0?'rate_secondabcd1234':'rate_secondother1234'
        }))
      };
    }
  });
  assert.equal(calls,2);
  assert.equal(result.carrierPreview.parcelCount,2);
  assert.equal(result.shippingCents,978);
  assert.equal(result.subtotalCents,1300);
});
test('test quote rejects duplicate EasyPost rate IDs across separate product units',async()=>{
  let calls=0;
  await assert.rejects(()=>prepareVerifiedCarrierCheckoutPreview({
    ...inputs({quantity:2}),quoteParcel:async()=>{
      calls++;
      return resultRate;
    }
  }),/reused/);
  assert.equal(calls,2);
});
test('international or invalid destination is rejected without carrier call',async()=>{
  let calls=0;
  await assert.rejects(()=>prepareVerifiedCarrierCheckoutPreview({
    ...inputs({shipTo:{...destination,country:'CA'}}),
    quoteParcel:async()=>{calls++;return resultRate;}
  }),/International/);
  assert.equal(calls,0);
});
test('a test-only adapter rejects production, paid labels, bad rate types and unsupported carriers',async()=>{
  const altered=[
    {...resultRate,mode:'production'},
    {...resultRate,labelPurchased:true},
    {...resultRate,options:[{...resultRate.options[0],currency:'CAD'}]},
    {...resultRate,options:[{...resultRate.options[0],carrier:'RoyalMail'}]},
    {...resultRate,options:[{...resultRate.options[0],rateId:'bad'}]},
  ];
  for(const response of altered)await assert.rejects(()=>
    prepareVerifiedCarrierCheckoutPreview({...inputs(),quoteParcel:async()=>response}));
});
