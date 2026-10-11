export function publicListingPriceIntegrity(product,expectedCents){
 if(!product||!Number.isSafeInteger(expectedCents)||expectedCents<1)return {valid:false};
 const price=product.salePrice;
 if(typeof price!=='number'||!Number.isFinite(price)||price<=0||price>50000)return {valid:false};
 return {valid:Math.abs(price*100-expectedCents)<1e-6,priceCents:Math.round(price*100)};
}
