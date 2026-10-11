import {authorizeListingOwner} from './marketplace-owner-isolation.mjs';
export function marketplaceStockOwnerGate({actorSellerId,listing,stock}){
 const ownership=authorizeListingOwner({actorSellerId,listing,action:'adjust-stock'});
 if(!ownership.allowed)return {allowed:false,reason:ownership.reason};
 if(!stock||stock.productId!==listing.listingId)return {allowed:false,reason:'STOCK_LISTING_MISMATCH'};
 return {allowed:true,listingId:listing.listingId};
}
