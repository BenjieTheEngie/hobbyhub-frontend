import {samePriorApprovalAudit} from './catalog-admin-logic.mjs';
export function approvalAuditConsistency({audit,productId,intent}){if(!audit)return {replay:false,conflict:false};const replay=samePriorApprovalAudit(audit,productId,intent);return {replay,conflict:!replay};}
