/** Pure ownership authorization for future multi-seller listing mutations.
 * Never infer seller ownership from a SKU or legacy productId.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function authorizeListingOwner({actorSellerId,listing,action}){
  if(!['read-private','edit-draft','adjust-stock','request-approval'].includes(action))
    throw Error('Unsupported seller listing action.');
  if(typeof actorSellerId!=='string'||!ID.test(actorSellerId))
    return {allowed:false,reason:'UNVERIFIED_ACTOR'};
  if(!listing||typeof listing!=='object'||typeof listing.listingId!=='string'||
     !ID.test(listing.listingId)||typeof listing.sellerId!=='string'||
     !ID.test(listing.sellerId))
    return {allowed:false,reason:'UNVERIFIED_LISTING_OWNER'};
  if(listing.sellerId!==actorSellerId)
    return {allowed:false,reason:'NOT_LISTING_OWNER'};
  if(action==='edit-draft'&&listing.status!=='DRAFT')
    return {allowed:false,reason:'NOT_DRAFT'};
  return {allowed:true,listingId:listing.listingId,action};
}
