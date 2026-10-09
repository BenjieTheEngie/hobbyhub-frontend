import {validateCheckoutIntent,verifyCheckoutQuote} from './checkout-v2-core.mjs';
import {
  parcelsForVerifiedCart,prepareCarrierQuoteRequest,aggregateMultiParcelRates,composeCarrierPrecheckout
} from './carrier-rating-v2.mjs';

/**
 * Server-side, OFFLINE-ONLY preview orchestration. No Stripe session,
 * DynamoDB writes, shipping label buys, reservations or order creation.
 * Caller MUST provide full server-authoritative product, stock and SKU
 * snapshots. Dimension/weight data comes ONLY from product shippingPackage.
 * Test-only carrier adapter is injected by an authenticated backend caller,
 * never passed through a customer-controlled request.
 */
export async function prepareVerifiedCarrierCheckoutPreview({
  cartRequest,productsById,stockById,skuCounts,
  origin,destination,quoteParcel
}={}){
  if(typeof quoteParcel!=='function')throw Error('Verified test carrier adapter is not configured.');
  const intent=validateCheckoutIntent(cartRequest);
  // Never contact the carrier for unpublished, ambiguous or out-of-stock lines.
  const productQuote=verifyCheckoutQuote(intent,{productsById,stockById,skuCounts});
  const packages=parcelsForVerifiedCart(intent,productsById);
  // Validates BOTH U.S. origin and destination. No pickup/international.
  const request=prepareCarrierQuoteRequest({origin,destination,parcel:packages[0]});
  const rated=[];
  for(const pack of packages){
    const result=await quoteParcel({
      origin:request.fromAddress,destination:request.toAddress,
      parcel:{lengthIn:pack.lengthIn,widthIn:pack.widthIn,heightIn:pack.heightIn,weightOz:pack.weightOz}
    });
    if(result?.provider!=='easypost'||result?.mode!=='test'||result?.rateOnly!==true||
       result?.labelPurchased!==false||!Array.isArray(result?.options)||
       result.options.length===0)
      throw Error('Test carrier provider did not confirm rates for all parcels.');
    const rates=result.options;
    if(rates.some(rate=>rate?.provider!=='easypost'||rate?.mode!=='test'||
       !['USPS','UPS','FEDEX'].includes(rate.carrier)||rate.currency!=='usd'||
       !/^rate_[A-Za-z0-9]{8,80}$/.test(rate.rateId||'')||
       !Number.isSafeInteger(rate.shippingCents)||rate.shippingCents<1))
      throw Error('Carrier provider returned an unverified shipping rate.');
    rated.push({productId:pack.productId,unit:pack.unit,options:rates});
  }
  const ratedSummary=aggregateMultiParcelRates(rated);
  const estimatedQuote=composeCarrierPrecheckout(productQuote,ratedSummary,request.toAddress);
  return {
    ...estimatedQuote,
    // Only rate options and a limited *state* indicator leave this function.
    // Raw shipping address, recipient, ZIP and provider credentials are omitted.
    carrierPreview:{
      provider:ratedSummary.provider,mode:'test',
      parcelCount:ratedSummary.parcelCount,
      rateOptions:ratedSummary.selectedRates.map(r=>({
        carrier:r.carrier,service:r.service,shippingCents:r.shippingCents,
        deliveryDays:r.deliveryDays,parcelUnit:r.unit,
      })),
      labelPurchased:false,
    },
    chargeable:false,
    pickupAvailable:false,
    checkoutReady:false
  };
}
