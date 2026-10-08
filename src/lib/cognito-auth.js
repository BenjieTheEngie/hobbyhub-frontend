/** Browser-side Cognito user-pool public client. No AWS keys or client secrets belong here. */
export class CognitoAuthError extends Error {
  constructor(message,code='CognitoAuthError') {super(message);this.name='CognitoAuthError';this.code=code;}
}

function authResult(payload) {
  if (payload?.AuthenticationResult?.IdToken && payload.AuthenticationResult.AccessToken) {
    return {kind:'authenticated',idToken:payload.AuthenticationResult.IdToken,accessToken:payload.AuthenticationResult.AccessToken};
  }
  if(payload?.ChallengeName==='NEW_PASSWORD_REQUIRED' && payload.Session){
    let requiredAttributes=[];
    try{const val=JSON.parse(payload.ChallengeParameters?.requiredAttributes||'[]');if(Array.isArray(val))requiredAttributes=[...new Set(val.filter(x=>typeof x==='string').map(x=>x.replace(/^userAttributes\./,'')).filter(x=>/^[a-zA-Z][\w:]*$/.test(x)))];}catch{/* Missing/invalid optional list */}
    return {kind:'new-password', session:payload.Session, username:payload.ChallengeParameters?.USER_ID_FOR_SRP||'',requiredAttributes};
  }
  if(payload?.ChallengeName)throw new CognitoAuthError(`Your account requires an additional ${payload.ChallengeName} sign-in step that this page does not yet support. Contact your administrator.`,'UnsupportedChallenge');
  throw new CognitoAuthError('Cognito did not return an authentication token.');
}

export function createCognitoClient({clientId,region,fetchImpl=globalThis.fetch}={}) {
  if(!/^[\da-z]+$/i.test(clientId||'')||!/^[a-z]{2}-[a-z]+-\d$/.test(region||''))throw new Error('A valid public Cognito app client ID and region are required.');
  const endpoint=`https://cognito-idp.${region}.amazonaws.com/`;
  async function send(action,body){
    const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':`AWSCognitoIdentityProviderService.${action}`},body:JSON.stringify(body)});
    let data={};try{data=await response.json();}catch{throw new CognitoAuthError('Unable to read the response from Cognito.');}
    if(!response.ok || data.__type){
      const type=String(data.__type||data.code||response.headers?.get?.('x-amzn-errortype')||'CognitoAuthError');
      const code=type.split('#').pop().split(':')[0];
      const msg=String(data.message||data.Message||`Cognito request failed (${response.status}).`);
      throw new CognitoAuthError(msg,code);
    }
    return data;
  }
  function username(value){const name=String(value||'').trim();if(!name)throw new CognitoAuthError('Enter the Cognito username or email address.','MissingUsername');return name;}
  function password(value){if(typeof value!=='string'||!value)throw new CognitoAuthError('Enter a password.','MissingPassword');return value;}
  return {
    async signIn(user,pass){
      const name=username(user);const data=await send('InitiateAuth',{AuthFlow:'USER_PASSWORD_AUTH',ClientId:clientId,AuthParameters:{USERNAME:name,PASSWORD:password(pass)}});
      const result=authResult(data);
      return result.kind==='new-password'?{...result,username:result.username||name}:result;
    },
    async requestPasswordReset(user){
      const data=await send('ForgotPassword',{ClientId:clientId,Username:username(user)});
      return {delivery:data.CodeDeliveryDetails?.DeliveryMedium||'configured recovery method',destination:data.CodeDeliveryDetails?.Destination||''};
    },
    async confirmPasswordReset(user,code,newPassword){
      const codeValue=String(code||'').trim();if(!codeValue)throw new CognitoAuthError('Enter the verification code.','MissingCode');
      await send('ConfirmForgotPassword',{ClientId:clientId,Username:username(user),ConfirmationCode:codeValue,Password:password(newPassword)});
      return true;
    },
    async completeNewPassword({session,username:user,newPassword,requiredAttributes={}}){
      if(!session)throw new CognitoAuthError('The temporary-password session expired. Sign in again.','MissingSession');
      const responses={USERNAME:username(user),NEW_PASSWORD:password(newPassword)};
      for(const [key,val] of Object.entries(requiredAttributes)){
        if(!/^[a-zA-Z][\w:]*$/.test(key)||!String(val).trim())throw new CognitoAuthError('Provide the required account attributes.','MissingAttribute');
        responses[`userAttributes.${key}`]=String(val).trim();
      }
      return authResult(await send('RespondToAuthChallenge',{ChallengeName:'NEW_PASSWORD_REQUIRED',ClientId:clientId,Session:session,ChallengeResponses:responses}));
    },
    async changePassword(accessToken,oldPassword,newPassword){
      if(!accessToken)throw new CognitoAuthError('Sign in before changing your password.','NotSignedIn');
      await send('ChangePassword',{AccessToken:accessToken,PreviousPassword:password(oldPassword),ProposedPassword:password(newPassword)});
      return true;
    }
  };
}
