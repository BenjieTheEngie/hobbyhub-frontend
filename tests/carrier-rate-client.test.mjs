import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCarrierRatePreview} from '../src/lib/carrierRateClient.js';

const base='https://test.example.invalid';
const token='test-admin-jwt';
const payload={destination:{recipient:'Demo',line1:'1 Sample St',city:'Boston',
  state:'MA',postalCode:'02110',country:'US'},
  parcel:{lengthIn:8,widthIn:6,heightIn:1,weightOz:4}};
const option={provider:'easypost',mode:'test',carrier:'USPS',service:'GroundAdvantage',
  rateId:'rate_abc123456789',shippingCents:475,currency:'usd',deliveryDays:3};

test('browser sends test rate inquiry only after explicit request with admin JWT',async()=>{
  let calls=0;
  const result=await fetchCarrierRatePreview(base,token,payload,async (url,init)=>{
    calls++;
    assert.equal(url,base+'/ops/shipping/rate-preview');
    assert.equal(init.method,'POST');
    assert.equal(init.headers.Authorization,'Bearer '+token);
    assert.equal(init.cache,'no-store');
    assert.deepEqual(JSON.parse(init.body),payload);
    assert.equal(JSON.parse(init.body).checkoutEnabled,undefined);
    assert.equal(JSON.parse(init.body).apiKey,undefined);
    return {ok:true,json:async()=>({
      provider:'easypost',mode:'test',rateOnly:true,
      labelPurchased:false,checkoutEnabled:false,options:[option]
    })};
  });
  assert.equal(calls,1);
  assert.deepEqual(result,[option]);
});
test('browser rejects missing authenticated API and production responses',async()=>{
  await assert.rejects(()=>fetchCarrierRatePreview('',token,payload),/not connected/);
  await assert.rejects(()=>fetchCarrierRatePreview(base,'',payload),/not connected/);
  await assert.rejects(()=>fetchCarrierRatePreview(base,token,payload,async()=>({ok:true,json:async()=>({
    provider:'easypost',mode:'production',rateOnly:true,
    labelPurchased:false,checkoutEnabled:false,options:[option]
  })})),/verified/);
  await assert.rejects(()=>fetchCarrierRatePreview(base,token,payload,async()=>({ok:true,json:async()=>({
    provider:'easypost',mode:'test',rateOnly:true,
    labelPurchased:true,checkoutEnabled:false,options:[option]
  })})),/verified/);
  await assert.rejects(()=>fetchCarrierRatePreview(base,token,payload,async()=>({ok:false,status:503,json:async()=>({
    message:'Carrier sandbox is offline'
  })})),/sandbox is offline/);
});
test('browser discards unverified prices, carriers and currencies',async()=>{
  const rows=await fetchCarrierRatePreview(base,token,payload,async()=>({ok:true,json:async()=>({
    provider:'easypost',mode:'test',rateOnly:true,labelPurchased:false,checkoutEnabled:false,
    options:[option,{...option,shippingCents:-1},{...option,mode:'production'},
      {...option,currency:'EUR'},{...option,carrier:'UNKNOWN'}, {...option,shippingCents:2.5}]
  })}));
  assert.deepEqual(rows,[option]);
});
