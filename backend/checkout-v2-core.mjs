/**
 * Checkout V2 PURE MODEL: no Stripe calls, no DynamoDB side effects.
 * Never deploy payment collection based on this file alone. Caller MUST
 * connect verified Stripe webhook handling and idempotent reservations.
 */
export const MAX_LINES=20;
export const MAX_QUANTITY=20;
export const MAX_ORDER_SUBTOTAL_CENTS=5_000_000;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCheckoutIntent(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw Error('Checkout request must be an object.');
  if(!UUID.test(payload.requestId||''))throw Error('Invalid checkout idempotency request ID.');
  if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>MAX_LINES)
    throw Error('Cart must have between 1 and 20 lines.');
  const ids=new Set();
  const items=payload.items.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||!ID.test(line.productId||''))
      throw Error('Cart contains an invalid productId.');
    const qty=line.qty;
    if(!Number.isSafeInteger(qty)||qty<1||qty>MAX_QUANTITY)
      throw Error('Cart quantity must be between 1 and 20.');
    if(ids.has(line.productId))throw Error('Cart contains duplicate product IDs.');
    if(Object.keys(line).some(key=>!['productId','qty'].includes(key)))
      throw Error('Cart lines may only contain productId and quantity; prices are server-authoritative.');
    ids.add(line.productId);
    return {productId:line.productId,qty};
  });
  return {requestId:payload.requestId.toLowerCase(),items};
}
export function priceCentsFromStoredDollars(price) {
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0||price>50000)
    throw Error('Verified product price is invalid.');
  const cents=Math.round(price*100);
  if(!Number.isSafeInteger(cents)||Math.abs(price*100-cents)>1e-6)
    throw Error('Product price has more than two decimal places.');
  return cents;
}
/**
 * All three Maps MUST be complete, read from strongly consistent records.
 * SKU counts come from a complete inventory lookup, not only cart lines,
 * because old DynamoDB records had duplicate SKU labels.
 *
 * Each stock row requires an explicit reserved field. Legacy Stock V2
 * records without it cannot be used for checkout until safely migrated.
 */
export function verifyCheckoutQuote(intent,{productsById,stockById,skuCounts}) {
  if(!(productsById instanceof Map)||!(stockById instanceof Map)||!(skuCounts instanceof Map))
    throw Error('Complete verified product, stock and unique-SKU snapshots are required.');
  const lines=[];let subtotalCents=0;const skus=new Set();
  for(const {productId,qty} of intent.items) {
    const product=productsById.get(productId);
    // Explicit ACTIVE approval is mandatory. A missing/unknown status must not
    // bypass the same fail-closed rule used by the public catalog and SKU resolver.
    if(!product||product.productId!==productId||product.published!==true||
       product.status!=='ACTIVE'||product.isactive===false||product.isActive===false)
      throw Error('Cart contains an unavailable or unpublished product.');
    const sku=String(product.sku||'').trim();
    if(!SKU.test(sku)||skuCounts.get(sku.toLowerCase())!==1||skus.has(sku.toLowerCase()))
      throw Error('Cart contains a duplicate or ambiguous SKU.');
    skus.add(sku.toLowerCase());
    const stock=stockById.get(productId);
    if(!stock||stock.productId!==productId||!Number.isSafeInteger(stock.version)||stock.version<1||
      !Number.isSafeInteger(stock.onHand)||stock.onHand<0||
      !Number.isSafeInteger(stock.reserved)||stock.reserved<0||stock.reserved>stock.onHand)
      throw Error('Verified available stock is not configured for this item.');
    if(qty>stock.onHand-stock.reserved)
      throw Error('Insufficient available stock for this item.');
    const unitPriceCents=priceCentsFromStoredDollars(product.salePrice);
    const lineTotalCents=qty*unitPriceCents;
    subtotalCents+=lineTotalCents;
    if(!Number.isSafeInteger(subtotalCents)||subtotalCents>MAX_ORDER_SUBTOTAL_CENTS)
      throw Error('Cart subtotal exceeds checkout limits.');
    lines.push({
      productId,sku,productName:String(product.productName||product.name||'').trim(),qty,
      unitPriceCents,lineTotalCents,stockVersion:stock.version,
      stockOnHand:stock.onHand,stockReserved:stock.reserved,
    });
    if(!lines[lines.length-1].productName)throw Error('Product name is missing.');
  }
  return {requestId:intent.requestId,currency:'usd',subtotalCents,items:lines,
    shippingCents:null,taxCents:null,totalCents:null,
    checkoutReady:false}; // Shipping/tax/payment must be server-confirmed.
}
/**
 * Future chargeable carrier quotes must bind the full destination with a
 * server-only HMAC and preserve each independently rated parcel rate ID.
 * Flat-rate/offline-only example quotes remain NONPAYMENT planning inputs.
 * No caller-supplied boolean is proof of a carrier API response: that
 * verification belongs to the trusted future backend before this helper.
 */
const SHIPPING_HMAC=/^hmac-v1-[a-f0-9]{64}$/;
const US_STATE=new Set(['AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','AK','HI']);
const RATE_ID=/^rate_[A-Za-z0-9]{8,80}$/;
function checkedCarrierCommitment(quote,holdUntil) {
  if(quote.carrierRateConfirmedForPayment!==true){
    if(quote.rateMode==='live')
      throw Error('Live carrier quote cannot omit server-confirmed payment eligibility.');
    return null;
  }
  if(quote.rateMode!=='live'||typeof quote.rateProvider!=='string'||
     !/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(quote.rateProvider)||
     quote.shippingAddressVerified!==true||
     !US_STATE.has(quote.shippingState)||
     !SHIPPING_HMAC.test(quote.shippingDestinationDigest||'')||
     typeof quote.carrierQuoteExpiresAt!=='string'||
     !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(quote.carrierQuoteExpiresAt)||
     !Number.isFinite(Date.parse(quote.carrierQuoteExpiresAt))||
     Date.parse(quote.carrierQuoteExpiresAt)<=Date.parse(holdUntil)||
     !Array.isArray(quote.carrierRateIds)||quote.carrierRateIds.length<1||
     quote.carrierRateIds.length>8||
     quote.carrierRateIds.some(id=>typeof id!=='string'||!RATE_ID.test(id))||
     new Set(quote.carrierRateIds).size!==quote.carrierRateIds.length||
     !Number.isSafeInteger(quote.ratedParcelCount)||
     quote.ratedParcelCount!==quote.carrierRateIds.length||
     quote.ratedParcelCount!==quote.items.reduce((sum,item)=>sum+item.qty,0)||
     !Array.isArray(quote.carrierRateDetails)||
     quote.carrierRateDetails.length!==quote.ratedParcelCount||
     quote.carrierRateDetails.some((rate,i)=>
       !rate||rate.rateId!==quote.carrierRateIds[i]||
       !Number.isSafeInteger(rate.shippingCents)||
       rate.shippingCents<1||rate.shippingCents>50000)||
     quote.carrierRateDetails.reduce((total,rate)=>total+rate.shippingCents,0)!==
       quote.shippingCents)
    throw Error('Carrier-confirmed prepayment quote requires a full address HMAC, unexpired per-unit parcel rates and exact verified shipping sum.');
  return Object.freeze({
    shippingDestinationDigest:quote.shippingDestinationDigest,
    shippingState:quote.shippingState,
    carrierQuoteExpiresAt:new Date(quote.carrierQuoteExpiresAt).toISOString(),
    carrierRateIds:[...quote.carrierRateIds],
    ratedParcelCount:quote.ratedParcelCount,
    carrierRateDetails:quote.carrierRateDetails.map(({rateId,shippingCents})=>({rateId,shippingCents})),
    rateProvider:quote.rateProvider,
    rateMode:'live'
  });
}
export function buildReservationTransactions(quote,{stockTable,orderTable,orderId,now,holdUntil}) {
  if(!stockTable||!orderTable||!ID.test(orderId||'')||!Number.isFinite(Date.parse(now))||
    !Number.isFinite(Date.parse(holdUntil))||Date.parse(holdUntil)<=Date.parse(now))
    throw Error('Valid order identity, table names and reservation expiry required.');
  if(!quote?.items?.length||quote.checkoutReady!==false)throw Error('Verified pre-checkout quote required.');
  // EasyPost test-rate previews are not chargeable and must never trigger
  // stock reservations, Stripe sessions or an executable order plan.
  if(quote.rateMode==='test'||quote.carrierRateConfirmedForPayment===false)
    throw Error('Carrier TEST quotes cannot authorize reservation or payment.');
  if(quote.shippingMethod!=='domestic_shipping'||quote.shippingCountry!=='US'||
     quote.pickupAvailable!==false || !['contiguous','alaska','hawaii'].includes(quote.shippingRegion) ||
     !Number.isSafeInteger(quote.shippingCents)||quote.shippingCents<0||quote.shippingCents>50000 ||
     quote.taxCents!==null || quote.totalCents!==null ||
     quote.preTaxCents!==quote.subtotalCents+quote.shippingCents)
    throw Error('Approved U.S. shipping estimate required; tax and charge total must remain pending.');
  const committedCarrier=checkedCarrierCommitment(quote,holdUntil);
  const stockWrites=quote.items.map(item=>({
    Update:{
      TableName:stockTable,Key:{productId:item.productId},
      UpdateExpression:'SET #reserved = #reserved + :qty, #version = #version + :one',
      ConditionExpression:'attribute_exists(productId) AND #version = :expected AND #onHand = :onHand AND #reserved = :reserved',
      ExpressionAttributeNames:{'#reserved':'reserved','#version':'version','#onHand':'onHand'},
      ExpressionAttributeValues:{
        ':qty':item.qty,':one':1,':expected':item.stockVersion,
        ':onHand':item.stockOnHand,':reserved':item.stockReserved
      }
    }
  }));
  const order={
    orderId,checkoutRequestId:quote.requestId,status:'RESERVED',paymentStatus:'PENDING',
    fulfillmentStatus:'UNFULFILLED',items:quote.items.map(({productId,sku,productName,qty,unitPriceCents,lineTotalCents})=>
      ({productId,sku,productName,qty,unitPriceCents,lineTotalCents})),
    subtotalCents:quote.subtotalCents,totalCents:null,
    shippingCents:quote.shippingCents,taxCents:null,currency:'usd',createdAt:now,updatedAt:now,
    shippingCountry:'US',shippingMethod:'domestic_shipping',shippingRegion:quote.shippingRegion,
    pickupAvailable:false,
    shippingAddressVerified:committedCarrier!==null,
    ...(committedCarrier||{}),
    reservedUntil:holdUntil,version:1,
  };
  const put={Put:{TableName:orderTable,Item:order,ConditionExpression:'attribute_not_exists(orderId)'}};
  if(stockWrites.length+1>100)throw Error('Transaction exceeds DynamoDB limits.');
  return {order,transactItems:[...stockWrites,put]};
}
export function fulfillmentEligible(order) {
  return Boolean(order&&order.paymentStatus==='PAID'&&order.status==='PAID'&&
    order.fulfillmentStatus==='UNFULFILLED'&&order.shippingMethod==='domestic_shipping'&&
    order.shippingCountry==='US'&&order.shippingAddressVerified===true&&
    order.pickupAvailable!==true&&Array.isArray(order.items)&&order.items.length>0);
}
