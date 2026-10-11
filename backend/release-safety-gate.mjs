export function releaseSafetyGate(input){
 const checks={catalog:Boolean(input?.catalogVerified),inventory:Boolean(input?.inventoryReconciled),shipping:Boolean(input?.carrierIntegrationTested),payments:Boolean(input?.paymentsTested),security:Boolean(input?.securityReviewed)};
 const publicListingReady=checks.catalog&&checks.inventory&&Boolean(input?.publicationAuthorized);
 const checkoutReady=publicListingReady&&checks.shipping&&checks.payments&&checks.security&&Boolean(input?.livePaymentActivationAuthorized);
 return {publicListingReady,checkoutReady,checks,livePaymentsEnabled:false};
}
