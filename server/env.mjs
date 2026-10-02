import 'dotenv/config';

const vercel = process.env.VERCEL === '1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT: use a whole number between 1 and 65535.');
const sessionSecret = process.env.SESSION_SECRET || '';
const origins = (process.env.APP_ORIGINS || process.env.APP_ORIGIN || (vercel && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')).split(',').map(value => value.trim()).filter(Boolean);
for (const origin of origins) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error(`Invalid APP_ORIGINS entry: ${origin}`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error(`APP_ORIGINS entries must be plain http(s) origins: ${origin}`);
}

/** @typedef {{vercel:boolean,port:number,host:string,origins:string[],sessionSecret:string,clientId:string,clientSecret:string,tenantId:string,redirectUri:string,maxDocumentBytes:number}} ServerConfig */
/** @type {ServerConfig} */
export const config = Object.freeze({
  vercel, port, host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), origins, sessionSecret,
  clientId: process.env.MICROSOFT_CLIENT_ID || '',
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
  tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
  redirectUri: process.env.MICROSOFT_REDIRECT_URI || `http://localhost:${port}/api/auth/callback`,
  hasExplicitRedirectUri: Boolean(process.env.MICROSOFT_REDIRECT_URI),
  appOrigin: origins[0] || 'http://localhost:5173',
  maxDocumentBytes: vercel ? 4 * 1024 * 1024 : 40 * 1024 * 1024,
});

export function logEnvironmentCheck() {
  const values = { APP_ORIGINS: config.origins.length > 0, SESSION_SECRET: config.sessionSecret.length >= 32, MICROSOFT_CLIENT_ID: Boolean(config.clientId), MICROSOFT_CLIENT_SECRET: Boolean(config.clientSecret), MICROSOFT_TENANT_ID: Boolean(config.tenantId), MICROSOFT_REDIRECT_URI: Boolean(process.env.MICROSOFT_REDIRECT_URI) };
  console.info(`Environment self-check (presence only): ${Object.entries(values).map(([key, present]) => `${key}=${present ? 'set' : 'unset'}`).join(' ')}`);
}
