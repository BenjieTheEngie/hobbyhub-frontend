export function claimsOf(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? event?.requestContext?.authorizer?.claims ?? {};
}
export function identityOf(event) { return claimsOf(event).sub || null; }
export function isAdmin(event, env = process.env) {
  const claims = claimsOf(event);
  const allowedSub = (env.HOBBYHUB_ALLOWED_ADMIN_SUBS || '').split(',').map(s => s.trim()).filter(Boolean);
  const raw = claims['cognito:groups'] ?? claims.groups ?? [];
  let groups = [];
  if (Array.isArray(raw)) groups = raw;
  else if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); groups = Array.isArray(parsed) ? parsed : [raw]; }
    catch { groups = raw.split(',').map(s => s.trim()); }
  }
  return Boolean(claims.sub) && (allowedSub.includes(claims.sub) || groups.some(g => String(g).trim().toLowerCase() === (env.HOBBYHUB_ADMIN_GROUP || 'hobbyhub-admin').toLowerCase()));
}
export function reply(code, data, origin = process.env.HOBBYHUB_ALLOWED_ORIGIN || 'https://hobbyhub.company') {
  return {statusCode: code, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin, Vary:'Origin'}, body:JSON.stringify(data)};
}
export function jsonBody(event) {
  if (!event.body) return {};
  let obj;
  try { obj = JSON.parse(event.body); } catch { throw new Error('Invalid JSON request body.'); }
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') throw new Error('Expected a JSON object.');
  return obj;
}
export function ownedUploadKey(sub, key) {
  return typeof sub === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(sub) && typeof key === 'string' && new RegExp(`^uploads/${sub}/[0-9a-f-]{36}\\.(?:png|jpg|webp)$`).test(key);
}
