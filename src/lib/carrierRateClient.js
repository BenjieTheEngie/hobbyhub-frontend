/**
 * Browser adapter for an administrator-only *TEST* shipping-rate preview.
 * Does not create checkout sessions, buy labels, or save shipping addresses.
 */
export async function fetchCarrierRatePreview(baseUrl,token,{destination,parcel},fetchImpl=fetch){
  if(typeof baseUrl!=='string'||!/^https:\/\//i.test(baseUrl) || !token)
    throw Error('Admin test carrier service is not connected.');
  if(!destination||!parcel)throw Error('A test destination and measured parcel are required.');
  const result=await fetchImpl(baseUrl.replace(/\/$/,'')+'/ops/shipping/rate-preview',{
    method:'POST',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({destination,parcel})
  });
  const body=await result.json().catch(()=>({}));
  if(!result.ok)throw Error(body.message||'No verified test carrier quote is available.');
  if(body.provider!=='easypost'||body.mode!=='test'||body.rateOnly!==true||
     body.labelPurchased!==false||body.checkoutEnabled!==false||
     !Array.isArray(body.options))
    throw Error('Response is not a verified carrier test-rate preview.');
  return body.options.filter(o=>o.provider==='easypost'&&o.mode==='test' &&
    ['USPS','UPS','FEDEX'].includes(o.carrier)&&typeof o.service==='string'&&
    Number.isSafeInteger(o.shippingCents)&&o.shippingCents>0&&
    o.currency==='usd');
}
