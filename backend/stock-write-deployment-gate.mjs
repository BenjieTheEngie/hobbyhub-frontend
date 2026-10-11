import {stockV2ConfigAudit} from './stock-v2-config-audit.mjs';
export function stockWriteDeploymentGate(env,verifiedDeployment){const c=stockV2ConfigAudit(env);return {allowWrites:c.writesEnabled&&verifiedDeployment===true,allowInitialize:c.initializationEnabled&&verifiedDeployment===true};}
