import {catalogApprovalConfigAudit} from './catalog-approval-config-audit.mjs';
export function catalogPublicationDeploymentGate(env,{authenticated=false,reviewed=false,authorized=false}={}){const c=catalogApprovalConfigAudit(env);return {allowApprovalWrite:c.writesEnabled&&authenticated&&reviewed,allowPublicListing:c.writesEnabled&&authenticated&&reviewed&&authorized,paymentsEnabled:false};}
