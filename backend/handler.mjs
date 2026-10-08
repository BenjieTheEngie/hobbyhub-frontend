import {randomUUID} from 'node:crypto';
import {S3Client, HeadObjectCommand, GetObjectCommand, CopyObjectCommand} from '@aws-sdk/client-s3';
import {createPresignedPost} from '@aws-sdk/s3-presigned-post';
import {RekognitionClient, DetectTextCommand} from '@aws-sdk/client-rekognition';
import {identityOf, isAdmin, jsonBody, reply, ownedUploadKey} from './security.mjs';
import {publicImageKey,checkImageSignature,normalizeScrydexVision} from './media-helpers.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
const s3 = new S3Client({});
const rekognition = new RekognitionClient({});
const bucket = () => process.env.HOBBYHUB_MEDIA_BUCKET;
const publicBase = () => process.env.HOBBYHUB_MEDIA_PUBLIC_BASE_URL;
function configReady() {return Boolean(bucket() && /^https:\/\//.test(publicBase() || ''));}
function authorized(event) {
  if (!identityOf(event)) return reply(401,{message:'Cognito authentication required.'});
  if (!isAdmin(event)) return reply(403,{message:'Administrator access required.'});
  return null;
}
async function checkedUpload(event) {
  const sub=identityOf(event), body=jsonBody(event);
  if(!ownedUploadKey(sub,body.key))return {error:reply(403,{message:'Only an upload owned by your administrator account is permitted.'})};
  const head=await s3.send(new HeadObjectCommand({Bucket:bucket(),Key:body.key}));
  if(!head.ContentLength || head.ContentLength>MAX_BYTES || !ALLOWED.has(head.ContentType))return {error:reply(400,{message:'Image size or content type is not permitted.'})};
  const chunk=await s3.send(new GetObjectCommand({Bucket:bucket(),Key:body.key,Range:'bytes=0-15'}));
  const bytes=await chunk.Body.transformToByteArray();
  if(!checkImageSignature(head.ContentType,bytes))return {error:reply(400,{message:'Uploaded file is not a valid PNG, JPEG or WebP image.'})};
  return {body,head};
}
export async function presignHandler(event) {
  const denied=authorized(event);if(denied)return denied;
  if(!configReady())return reply(503,{message:'S3 media upload is not yet configured.'});
  let data;try{data=jsonBody(event);}catch{return reply(400,{message:'Invalid upload request.'});}
  const {contentType,size}=data;
  if(!ALLOWED.has(contentType)||!Number.isInteger(size)||size<1||size>MAX_BYTES)return reply(400,{message:'Choose a PNG, JPG or WebP image under 8 MB.'});
  try {
    const extension=contentType==='image/png'?'png':contentType==='image/webp'?'webp':'jpg';
    const key=`uploads/${identityOf(event)}/${randomUUID()}.${extension}`;
    const presigned=await createPresignedPost(s3,{Bucket:bucket(),Key:key,Expires:180,Fields:{'Content-Type':contentType},Conditions:[['content-length-range',1,MAX_BYTES],['eq','$Content-Type',contentType]]});
    return reply(200,{uploadMethod:'POST',uploadUrl:presigned.url,fields:presigned.fields,key});
  }catch(e){console.error('S3 presign error',e);return reply(502,{message:'Unable to prepare image upload.'});}
}
export async function completeHandler(event) {
  const denied=authorized(event);if(denied)return denied;
  if(!configReady())return reply(503,{message:'Media delivery not configured.'});
  try {
    const {error,body,head}=await checkedUpload(event);if(error)return error;
    const dest=`products/${publicImageKey(body.key)}`;
    await s3.send(new CopyObjectCommand({Bucket:bucket(),Key:dest,CopySource:`${bucket()}/${body.key.split('/').map(encodeURIComponent).join('/')}`,ContentType:head.ContentType,MetadataDirective:'REPLACE',CacheControl:'public,max-age=31536000,immutable'}));
    return reply(200,{imageUrl:`${publicBase().replace(/\/$/,'')}/${publicImageKey(body.key)}`,key:dest});
  }catch(e){console.error('Media finalize error',e);return reply(502,{message:'Uploaded photo could not be finalized.'});}
}
function cardImage(card){return card?.image_uris?.normal || card?.card_faces?.find(f=>f.image_uris?.normal)?.image_uris?.normal || '';}
async function magicOCR(key){
  const detected=await rekognition.send(new DetectTextCommand({Image:{S3Object:{Bucket:bucket(),Name:key}}}));
  const candidates=(detected.TextDetections||[]).filter(x=>x.Type==='LINE'&&x.Confidence>=75).map(x=>x.DetectedText?.trim()).filter(s=>s?.length>2&&s.length<65&&/[A-Za-z]/.test(s)).slice(0,4);
  for(const candidate of candidates){
    try{
      const response=await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(candidate)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(3500)});
      if(!response.ok)continue;
      const card=await response.json(), tokens=candidate.toLowerCase().split(/\W+/).filter(x=>x.length>=3);
      if(tokens.length&&!tokens.some(t=>card.name?.toLowerCase().includes(t)))continue;
      return {match:{productName:card.name,setCode:card.set?.toUpperCase()||'',collectorNumber:card.collector_number||'',category:'Magic: The Gathering',imageUrl:cardImage(card)},ocrMatchedText:candidate,requiresHumanReview:true,source:'Scryfall + AWS OCR'};
    }catch{/* Try next candidate */}
  }
  return null;
}
async function paidVision(key,game) {
  const apiKey=process.env.HOBBYHUB_SCRYDEX_API_KEY,team=process.env.HOBBYHUB_SCRYDEX_TEAM_ID;
  if(process.env.HOBBYHUB_ENABLE_PAID_VISION!=='true'||!apiKey||!team)return null;
  const obj=await s3.send(new GetObjectCommand({Bucket:bucket(),Key:key}));
  if((obj.ContentLength||0)>MAX_BYTES)throw new Error('Scan file exceeds size limit.');
  const bytes=await obj.Body.transformToByteArray();
  const form=new FormData();form.append('image',new Blob([bytes],{type:obj.ContentType}),key.split('/').at(-1));
  form.append('games',game==='Pokémon'?'pokemon':'magicthegathering');
  const response=await fetch('https://api.scrydex.com/vision/v1/cards/identify',{method:'POST',headers:{'X-Api-Key':apiKey,'X-Team-ID':team},body:form,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Vision provider error (${response.status}).`);
  return normalizeScrydexVision(await response.json(),game);
}
async function yugiohOCR(key){
  const detected=await rekognition.send(new DetectTextCommand({Image:{S3Object:{Bucket:bucket(),Name:key}}}));
  const names=(detected.TextDetections||[]).filter(t=>t.Type==='LINE'&&t.Confidence>=75).map(t=>t.DetectedText?.trim()).filter(s=>s&&s.length>2&&s.length<70).slice(0,6);
  for(const candidate of names){
    try{
      const response=await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(candidate)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(3500)});
      if(!response.ok)continue;
      const data=await response.json(),card=data?.data?.[0];
      if(!card?.name||card.name.toLowerCase()!==candidate.toLowerCase())continue;
      return {match:{productName:card.name,category:'Yu-Gi-Oh!',setCode:card.card_sets?.[0]?.set_code||'',catalogId:String(card.id||''),imageUrl:''},requiresHumanReview:true,source:'AWS OCR + YGOPRODeck',notice:'Name is OCR-based. Verify set and artwork, and upload your own photograph; external image hotlinking is prohibited.'};
    }catch{/* continue scanning alternatives */}
  }
  return null;
}
export async function recognizeHandler(event){
  const denied=authorized(event);if(denied)return denied;
  if(!configReady())return reply(503,{message:'Scanning storage is not configured.'});
  let upload;
  try{upload=await checkedUpload(event);}catch(e){console.error('Scan image validation',e);return reply(422,{message:'Could not access the uploaded image.'});}
  if(upload.error)return upload.error;
  const {key,game}=upload.body;
  if(!['Magic: The Gathering','Pokémon','Yu-Gi-Oh!'].includes(game))return reply(400,{message:'Choose a supported trading card game.'});
  try{
    let identified=game==='Yu-Gi-Oh!'?null:await paidVision(key,game);
    if(!identified && game==='Magic: The Gathering' && !key.endsWith('.webp'))identified=await magicOCR(key);
    if(!identified && game==='Yu-Gi-Oh!' && !key.endsWith('.webp'))identified=await yugiohOCR(key);
    if(!identified && game==='Yu-Gi-Oh!' && key.endsWith('.webp'))return reply(422,{message:'Use JPG or PNG for Yu-Gi-Oh! OCR.'});
    if(!identified && game==='Pokémon')return reply(503,{message:'Pokémon photo recognition requires authorized Scrydex Vision credentials.'});
    if(!identified)return reply(422,{message:'No reliable match found; try another photo or manual lookup.'});
    return reply(200,identified);
  }catch(e){console.error('Card recognition error',e);return reply(502,{message:'Recognition service unavailable. Manual entry remains available.'});}
}

// API Gateway route dispatcher: all three paths share one Lambda function.
export async function mediaHandler(event){
  const route=event.rawPath || event.path || event.requestContext?.http?.path || '';
  const method=event.requestContext?.http?.method || event.httpMethod || '';
  if(method!=='POST')return reply(405,{message:'POST required.'});
  if(route.endsWith('/uploads/presign'))return presignHandler(event);
  if(route.endsWith('/uploads/complete'))return completeHandler(event);
  if(route.endsWith('/scan/recognize'))return recognizeHandler(event);
  return reply(404,{message:'Unknown media operation.'});
}
