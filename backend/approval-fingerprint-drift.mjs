import {publicationFingerprint,approvalForProduct} from './publication-approvals.mjs';
export function approvalFingerprintDrift(product,approval){
 if(!approval)return {valid:false,reason:'NO_APPROVAL'};
 try{const fingerprint=publicationFingerprint(product);return {valid:approvalForProduct(product,approval),reason:approvalForProduct(product,approval)?null:'FINGERPRINT_OR_APPROVAL_MISMATCH',fingerprint};}
 catch{return {valid:false,reason:'INVALID_PRODUCT'};}
}
