import {identityOf,isAdmin} from './security.mjs';
export function adminRequestAuthGate(event,method='GET'){if(!identityOf(event))return {allowed:false,status:401};if(!isAdmin(event))return {allowed:false,status:403};if((event.requestContext?.http?.method||event.httpMethod)!==method)return {allowed:false,status:405};return {allowed:true,status:200};}
