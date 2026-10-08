// Pure functions, intentionally separated from AWS SDK for offline testing.
export function publicImageKey(uploadKey) {
  if (typeof uploadKey !== 'string' || !/^uploads\//.test(uploadKey)) throw new Error('Expected a staged image key.');
  return uploadKey.slice('uploads/'.length);
}
export function checkImageSignature(contentType, bytes) {
  const a=Array.from(bytes || []);
  if(contentType==='image/png')return a.length>=8 && [137,80,78,71,13,10,26,10].every((b,i)=>a[i]===b);
  if(contentType==='image/jpeg')return a.length>=3 && a[0]===255 && a[1]===216 && a[2]===255;
  if(contentType==='image/webp')return a.length>=12 && String.fromCharCode(...a.slice(0,4))==='RIFF' && String.fromCharCode(...a.slice(8,12))==='WEBP';
  return false;
}
export function normalizeScrydexVision(result,game) {
  const candidate=result?.data?.matches?.[0],card=candidate?.card;
  if(!card?.name)return null;
  const images=card.images||[],image=images.find(x=>x.type==='front')||images[0];
  return {match:{productName:card.name,category:game,setCode:String(card.expansion?.id||'').toUpperCase(),collectorNumber:String(card.number||''),catalogId:String(card.id||''),imageUrl:image?.large||image?.medium||''},confidenceScore:candidate.score,requiresHumanReview:true,source:'Scrydex Vision',notice:'Verify exact printing, artwork, condition and image display rights.'};
}
