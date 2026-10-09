import {validatedPackedParcel} from './carrier-rating-v2.mjs';

/**
 * Independent server-side shipping profile model. Existing Products and
 * Inventory tables stay unchanged. These profiles are DRAFT / staging only.
 * Passing dimension validation never authorizes an actual shipping charge.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VERSION=100000000;
function validId(id,label='productId') {
  if(typeof id!=='string'||!ID.test(id))throw Error('Invalid '+label+'.');
  return id;
}
function strictVersion(value,allowZero=false) {
  if(!Number.isSafeInteger(value)||value<(allowZero?0:1)||value>MAX_VERSION)
    throw Error('Expected shipping profile version is invalid.');
  return value;
}
function noteOf(value) {
  if(value===undefined||value===null)return '';
  if(typeof value!=='string'||value.length>180||/[\u0000-\u001f\u007f]/.test(value))
    throw Error('Packaging note contains unsupported characters.');
  return value.trim();
}
export function validateShippingProfileDraft(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Shipping profile requires a measured package.');
  const requestId=input.requestId;
  if(typeof requestId!=='string'||!UUID.test(requestId))
    throw Error('A valid idempotency request ID is required.');
  const expectedVersion=strictVersion(input.expectedVersion,true);
  const shippingPackage=validatedPackedParcel(input.shippingPackage);
  if(input.shippingMode!==undefined && input.shippingMode!=='domestic_shipping')
    throw Error('Only domestic shipping profiles are supported.');
  if(input.published===true||input.checkoutReady===true||input.verifiedForLiveCheckout===true)
    throw Error('Draft measurements cannot enable publication or checkout.');
  return {
    requestId:requestId.toLowerCase(),expectedVersion,
    shippingPackage,note:noteOf(input.note),
    shippingMode:'domestic_shipping'
  };
}
export function readShippingProfile(row) {
  if(!row || typeof row!=='object'||Array.isArray(row))throw Error('Invalid stored shipping profile.');
  const productId=validId(row.productId);
  const shippingPackage=validatedPackedParcel(row.shippingPackage);
  const version=strictVersion(row.version);
  if(row.status!=='DRAFT'||row.verifiedForLiveCheckout!==false ||
    typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))
    throw Error('Shipping profile is not a verified draft.');
  return {productId,shippingPackage,version,status:'DRAFT',verifiedForLiveCheckout:false,
    note:noteOf(row.note),updatedAt:row.updatedAt};
}
export function readShippingProfileList(rows) {
  if(!Array.isArray(rows))throw Error('Complete shipping profile list is required.');
  const seen=new Set();
  return rows.map(row=>{
    const normalized=readShippingProfile(row);
    if(seen.has(normalized.productId))throw Error('Duplicate shipping profile productId.');
    seen.add(normalized.productId);
    return normalized;
  });
}
/**
 * Pure conditional DynamoDB write plan. Separate DynamoDB function MUST
 * check the authorized admin and verify productId exists before using it.
 * There is no live API or AWS invocation in this module.
 */
export function draftProfileTransactionPlan(productId,input,{profileTable,auditTable,actorId,now}={}) {
  validId(productId);
  validId(actorId,'admin actor');
  if(typeof profileTable!=='string'||!profileTable||
    typeof auditTable!=='string'||!auditTable||profileTable===auditTable)
    throw Error('Distinct shipping profile and audit tables are required.');
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))throw Error('Valid timestamp required.');
  const draft=validateShippingProfileDraft(input);
  const afterVersion=draft.expectedVersion+1;
  const record={
    productId,shippingPackage:draft.shippingPackage,note:draft.note,
    status:'DRAFT',verifiedForLiveCheckout:false,shippingMode:'domestic_shipping',
    version:afterVersion,updatedAt:now
  };
  const audit={
    requestId:draft.requestId,productId,actorId,operation:'set-package-draft',
    expectedVersion:draft.expectedVersion,newVersion:afterVersion,
    shippingPackage:draft.shippingPackage,note:draft.note,createdAt:now
  };
  const operation=draft.expectedVersion===0?{
    Put:{TableName:profileTable,
      Item:{...record,createdAt:now},
      ConditionExpression:'attribute_not_exists(productId)'}
  }:{
    Update:{TableName:profileTable,Key:{productId},
      UpdateExpression:'SET #parcel = :parcel, #note = :note, #status = :draft, #approved = :no, #mode = :method, #version = #version + :one, #updated = :now',
      ConditionExpression:'attribute_exists(productId) AND #version = :expected AND #status = :draft',
      ExpressionAttributeNames:{
        '#parcel':'shippingPackage','#note':'note','#status':'status',
        '#approved':'verifiedForLiveCheckout','#mode':'shippingMode',
        '#version':'version','#updated':'updatedAt'
      },
      ExpressionAttributeValues:{
        ':parcel':draft.shippingPackage,':note':draft.note,
        ':draft':'DRAFT',':no':false,':method':'domestic_shipping',
        ':one':1,':expected':draft.expectedVersion,':now':now
      }
    }
  };
  return {
    kind:'shipping-profile-draft-only',executable:false,
    productId,requestId:draft.requestId,expectedVersion:draft.expectedVersion,
    profile:record,
    transactItems:[
      operation,
      {Put:{TableName:auditTable,Item:audit,
        ConditionExpression:'attribute_not_exists(requestId)'}}
    ]
  };
}
export function attachMeasuredDraftProfilesForSandbox(productsById,profileRows) {
  if(!(productsById instanceof Map))throw Error('Authoritative product snapshot required.');
  const profiles=readShippingProfileList(profileRows);
  const joined=new Map(productsById);
  for(const profile of profiles) {
    const row=productsById.get(profile.productId);
    if(!row||row.productId!==profile.productId)
      throw Error('Shipping profile references an unknown productId.');
    joined.set(profile.productId,{
      ...row,shippingPackage:profile.shippingPackage,
      shippingProfileVersion:profile.version,
      shippingProfileStatus:'DRAFT',verifiedForLiveCheckout:false
    });
  }
  // For injected TEST quote provider only. Never use for production checkout.
  return joined;
}
