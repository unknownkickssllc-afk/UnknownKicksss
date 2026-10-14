const crypto = require('node:crypto');

function secretKey(env = process.env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) throw new Error('Integration encryption is not configured.');
  return crypto.hkdfSync('sha256', Buffer.from(env.SESSION_SECRET), Buffer.from('unknown-kickss'), Buffer.from('automation-credentials-v1'), 32);
}
function seal(value, env) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secretKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function unseal(value, env) {
  const [version, iv, tag, data, extra] = String(value || '').split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error('Reconnect this integration.');
  const cipher = crypto.createDecipheriv('aes-256-gcm', secretKey(env), Buffer.from(iv, 'base64url'));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8'));
}
function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyInstagram(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature) || !secret) return false;
  return equalSecret(signature, 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'));
}
module.exports = { seal, unseal, equalSecret, verifyInstagram };
