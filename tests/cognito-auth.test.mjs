import test from 'node:test';
import assert from 'node:assert/strict';
import {createCognitoClient} from '../src/lib/cognito-auth.js';

function mockCognito(responseFactory){
  const calls=[];
  const client=createCognitoClient({clientId:'9qrtgdn5dtoqhc3brmr03mgn0',region:'us-east-2',fetchImpl:async(url,options)=>{
    calls.push({url,target:options.headers['X-Amz-Target'],body:JSON.parse(options.body),headers:options.headers});
    const answer=await responseFactory(calls.at(-1));
    return {ok:answer.ok??true,status:answer.status??200,headers:{get:()=>null},json:async()=>answer.data};
  }});
  return {calls,client};
}
test('successful Cognito sign in returns ID and access token (only in memory)',async()=>{
 const {calls,client}=mockCognito(()=>({data:{AuthenticationResult:{IdToken:'id-token',AccessToken:'access-token'}}}));
 assert.deepEqual(await client.signIn('  admin@example.com ','pass'),{kind:'authenticated',idToken:'id-token',accessToken:'access-token'});
 assert.equal(calls[0].url,'https://cognito-idp.us-east-2.amazonaws.com/');
 assert.equal(calls[0].body.AuthParameters.USERNAME,'admin@example.com');
 assert.match(calls[0].target,/InitiateAuth$/);
});
test('reset required preserves Cognito error code so UI can offer recovery',async()=>{
 const {client}=mockCognito(()=>({ok:false,status:400,data:{__type:'com.amazon.coral.service#PasswordResetRequiredException',message:'Password reset required for the user'}}));
 await assert.rejects(()=>client.signIn('admin','old'),e=>e.code==='PasswordResetRequiredException');
});
test('ForgotPassword and ConfirmForgotPassword use Cognito APIs without AWS credentials',async()=>{
 const {client,calls}=mockCognito(({target})=>({data:target.endsWith('ForgotPassword')?{CodeDeliveryDetails:{Destination:'n***@example.com',DeliveryMedium:'EMAIL'}}:{}}));
 const delivery=await client.requestPasswordReset(' admin@example.com ');
 assert.deepEqual(delivery,{delivery:'EMAIL',destination:'n***@example.com'});
 await client.confirmPasswordReset('admin@example.com',' 123456 ','strongNewPassword!42');
 assert.deepEqual(calls.map(c=>c.target.split('.').at(-1)),['ForgotPassword','ConfirmForgotPassword']);
 assert.equal(calls[1].body.ConfirmationCode,'123456');
 assert.equal(calls[1].body.Password,'strongNewPassword!42');
 assert.ok(!('Authorization' in calls[0].headers));
});
test('temporary-password challenge completes with Cognito response session and required attributes',async()=>{
 const {client,calls}=mockCognito(({target})=>({data:target.endsWith('InitiateAuth')?{ChallengeName:'NEW_PASSWORD_REQUIRED',Session:'cognito_session_string',ChallengeParameters:{USER_ID_FOR_SRP:'admin-user',requiredAttributes:'["userAttributes.given_name"]'}}:{AuthenticationResult:{IdToken:'changed-id',AccessToken:'changed-access'}}}));
 const first=await client.signIn('admin@example.com','temporary');
 assert.deepEqual(first,{kind:'new-password',session:'cognito_session_string',username:'admin-user',requiredAttributes:['given_name']});
 assert.deepEqual(await client.completeNewPassword({session:first.session,username:first.username,newPassword:'newSecurePwd!12',requiredAttributes:{given_name:'Admin'}}),{kind:'authenticated',idToken:'changed-id',accessToken:'changed-access'});
 assert.equal(calls[1].body.ChallengeResponses['userAttributes.given_name'],'Admin');
 assert.equal(calls[1].body.Session,'cognito_session_string');
 assert.equal(calls[1].body.ChallengeName,'NEW_PASSWORD_REQUIRED');
});
test('signed-in password change uses access token, not ID token',async()=>{
 const {client,calls}=mockCognito(()=>({data:{}}));
 await client.changePassword('access-token','old','new');
 assert.equal(calls[0].body.AccessToken,'access-token');
 assert.equal(calls[0].body.PreviousPassword,'old');
 assert.equal(calls[0].body.ProposedPassword,'new');
 assert.match(calls[0].target,/ChangePassword$/);
});
test('unsupported MFA challenge is not mistaken for a login',async()=>{
 const {client}=mockCognito(()=>({data:{ChallengeName:'SOFTWARE_TOKEN_MFA',Session:'cognito_session'}}));
 await assert.rejects(()=>client.signIn('admin','pwd'),e=>e.code==='UnsupportedChallenge');
});
test('invalid Cognito region/client id fails closed',()=>{
 assert.throws(()=>createCognitoClient({clientId:'',region:'us-east-2'}),/valid public/);
 assert.throws(()=>createCognitoClient({clientId:'abc',region:'http://evil'}),/valid public/);
});
