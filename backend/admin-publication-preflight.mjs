import {firstListingReadiness} from './first-listing-readiness.mjs';
import {firstListingMetadataPreflight} from './first-listing-metadata-preflight.mjs';
export function adminPublicationPreflight({product,stock,approval,expectedPrice,expectedQuantity,expectedMetadata}){
 const metadata=firstListingMetadataPreflight(product,expectedMetadata);
 const inventory=firstListingReadiness({product,stock,approval,expectedPrice,expectedQuantity});
 return {ready:metadata.verified&&inventory.ready,metadata,inventory,paymentsEnabled:false};
}
