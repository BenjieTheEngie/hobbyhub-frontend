import {adminPublicationPreflight} from './admin-publication-preflight.mjs';
export function firstListingStagingSmoke(product){return adminPublicationPreflight({product,stock:null,approval:null,expectedPrice:7.5,expectedQuantity:1,expectedMetadata:{productId:'prd_9bfd1285-899c-45cb-869c-6058aff5b424',productName:'Lightning Bolt',finish:'party-foil'}});}
