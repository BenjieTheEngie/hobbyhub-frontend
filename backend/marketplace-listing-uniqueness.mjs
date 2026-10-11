export function validateMarketplaceListingIdentity(listings){
 if(!Array.isArray(listings))throw Error('Complete listing snapshot required.');
 const seen=new Set();
 for(const row of listings){
  if(!row||typeof row.listingId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.listingId)||typeof row.sellerId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.sellerId)||seen.has(row.listingId))throw Error('Invalid or duplicate seller listing identity.');
  seen.add(row.listingId);
 }
 return {valid:true,count:seen.size};
}
