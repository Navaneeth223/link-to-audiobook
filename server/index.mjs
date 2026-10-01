import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { graphShareId, publicAddress, readableDocumentType, readJsonResponse, validShareUrl } from './security.mjs';
import { config, logEnvironmentCheck } from './env.mjs';

const app = express();
if (process.env.NODE_ENV === 'production' || config.vercel) app.set('trust proxy', 1);
const MAX_BYTES = config.maxDocumentBytes;
const MAX_MB = Math.floor(MAX_BYTES / (1024 * 1024));
const isConfigured = Boolean(config.clientId && config.clientSecret && config.sessionSecret);
const redirectUri = config.redirectUri;
const msal = isConfigured ? new ConfidentialClientApplication({ auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`, clientSecret: config.clientSecret } }) : null;
const scopes = ['Files.Read', 'offline_access', 'openid'];
function apiError(res, status, code, message) { return res.status(status).json({ ok: false, error: { code, message } }); }

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'", 'https://login.microsoftonline.com'] } }, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use((req, res, next) => {
  if (req.headers.origin && !config.origins.includes(req.headers.origin)) return apiError(res, 403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.');
  if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
  res.setHeader('Cache-Control', 'no-store'); next();
});
app.use(express.json({ limit: '8kb', type: 'application/json' }));
app.use(session({ name: 'psr.sid', secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production' || config.vercel, sameSite: process.env.NODE_ENV === 'production' || config.vercel ? 'none' : 'lax', maxAge: 60 * 60 * 1000 } }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => apiError(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.') }));

async function downloadPinned(urlString) {
  const url = new URL(urlString);
  const allowed = ['sharepoint.com', '1drv.com', 'onedrive.live.com', 'blob.core.windows.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || !allowed || url.port) throw new Error('Microsoft returned an unsupported download location.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) throw new Error('The document host resolved to a restricted network address.');
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: url.hostname, path: `${url.pathname}${url.search}`, servername: url.hostname, lookup: (_host, _opts, callback) => callback(null, addresses[0].address, net.isIPv4(addresses[0].address) ? 4 : 6), timeout: 20_000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('The document could not be downloaded from Microsoft.')); return; }
      const headers = { contentType: String(response.headers['content-type'] || ''), disposition: String(response.headers['content-disposition'] || '') };
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_BYTES) { response.destroy(); reject(new Error(`This document is larger than the ${MAX_MB} MB limit.`)); return; }
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > MAX_BYTES) { response.destroy(new Error(`This document is larger than the ${MAX_MB} MB limit.`)); return; } chunks.push(chunk); });
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), ...headers }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Microsoft document download timed out.')));
    request.on('error', reject);
  });
}
function requireConfigured(req, res, next) { if (!msal) return apiError(res, 503, 'MICROSOFT_NOT_CONFIGURED', 'Microsoft sign-in is not configured on this server.'); next(); }

app.get('/api/health', (_req, res) => res.json({ ok: true, version: process.env.npm_package_version || '1.0.0', providersConfigured: { microsoftOAuth: isConfigured } }));
app.get('/api/auth/status', (_req, res) => res.json({ ok: true, authenticated: Boolean(_req.session.accessToken && _req.session.tokenExpiresAt > Date.now()), configured: isConfigured }));
app.get('/api/auth/login', requireConfigured, async (req, res, next) => {
  try { const state = crypto.randomBytes(32).toString('base64url'); const codeVerifier = crypto.randomBytes(32).toString('base64url'); const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url'); req.session.oauthState = state; req.session.codeVerifier = codeVerifier; const url = await msal.getAuthCodeUrl({ scopes, redirectUri, state, codeChallenge, codeChallengeMethod: 'S256', prompt: 'select_account' }); res.redirect(url); } catch (error) { next(error); }
});
app.get('/api/auth/callback', requireConfigured, async (req, res, next) => {
  const { code, state, error } = req.query;
  const expectedState = req.session.oauthState;
  if (error || typeof code !== 'string' || typeof state !== 'string' || !expectedState || Buffer.byteLength(state) !== Buffer.byteLength(expectedState) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) return apiError(res, 400, 'OAUTH_STATE_INVALID', 'Microsoft sign-in could not be completed. Return to the reader and try again.');
  delete req.session.oauthState;
  const codeVerifier = req.session.codeVerifier; delete req.session.codeVerifier;
  if (!codeVerifier) return apiError(res, 400, 'OAUTH_VERIFIER_MISSING', 'Microsoft sign-in could not be completed. Return to the reader and try again.');
  try { const result = await msal.acquireTokenByCode({ code, scopes, redirectUri, codeVerifier }); req.session.accessToken = result.accessToken; req.session.tokenExpiresAt = result.expiresOn?.getTime() || Date.now() + 50 * 60_000; req.session.save(() => res.redirect(`${config.appOrigin}/?microsoftConnected=1`)); } catch (cause) { next(cause); }
});
app.post('/api/auth/logout', (req, res, next) => req.session.destroy(error => {
  if (error) return next(error);
  res.clearCookie('psr.sid', { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' || config.vercel ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production' || config.vercel });
  return res.json({ ok: true });
}));
async function getSharedDocument(url, accessToken) {
    const shareId = graphShareId(url);
    const metadataResponse = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem?$select=id,name,size,file`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (metadataResponse.status === 401) throw Object.assign(new Error('Your Microsoft session expired. Sign in again to continue.'), { status: 401 });
    if (metadataResponse.status === 403 || metadataResponse.status === 404) throw Object.assign(new Error('You don’t currently have permission to read this document.'), { status: 403 });
    if (!metadataResponse.ok) throw Object.assign(new Error('Microsoft could not open this sharing link.'), { status: 502 });
    const metadata = await readJsonResponse(metadataResponse, 'Microsoft returned an empty or invalid response for this sharing link. Check the link and try again.');
    if (!metadata.file || !/\.(txt|md|markdown|pdf|docx|epub)$/i.test(metadata.name || '')) throw Object.assign(new Error('Choose a TXT, Markdown, PDF, DOCX, or EPUB document.'), { status: 415 });
    if (metadata.size > MAX_BYTES) throw Object.assign(new Error(`This document is larger than the ${MAX_MB} MB limit.`), { status: 413 });
    const contentResponse = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const location = contentResponse.headers.get('location');
    if (contentResponse.status !== 302 || !location) throw Object.assign(new Error('Microsoft did not provide an accessible download for this document.'), { status: 502 });
    const downloaded = await downloadPinned(location);
    if (!readableDocumentType(downloaded.bytes, { name: metadata.name, ...downloaded })) throw Object.assign(new Error('Microsoft returned a sign-in page or a file that is not a supported readable document.'), { status: 415 });
    return { bytes: downloaded.bytes, name: metadata.name };
}
function sendDocument(res, document) { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', document.bytes.length); res.setHeader('X-Document-Name', encodeURIComponent(document.name)); res.send(document.bytes); }
app.post('/api/documents/shared', async (req, res, next) => {
  const { url } = req.body || {};
  if (!validShareUrl(url)) return apiError(res, 400, 'SHARE_URL_INVALID', 'Paste an HTTPS OneDrive or SharePoint sharing link.');
  if (!isConfigured) return apiError(res, 503, 'MICROSOFT_NOT_CONFIGURED', 'Microsoft sign-in is not configured on this server.');
  if (!req.session.accessToken || req.session.tokenExpiresAt <= Date.now()) { req.session.pendingShareUrl = url; return apiError(res, 401, 'SIGN_IN_REQUIRED', 'Sign in with Microsoft to open this document.'); }
  try { const document = await getSharedDocument(url, req.session.accessToken); delete req.session.pendingShareUrl; sendDocument(res, document); }
  catch (error) { if (error.status === 401) { delete req.session.accessToken; req.session.pendingShareUrl = url; } next(error); }
});
app.post('/api/documents/pending', async (req, res, next) => {
  const url = req.session.pendingShareUrl;
  if (!url || !validShareUrl(url)) return apiError(res, 404, 'PENDING_DOCUMENT_NOT_FOUND', 'There is no pending document.');
  if (!req.session.accessToken || req.session.tokenExpiresAt <= Date.now()) return apiError(res, 401, 'SIGN_IN_REQUIRED', 'Sign in with Microsoft to open this document.');
  delete req.session.pendingShareUrl;
  try { sendDocument(res, await getSharedDocument(url, req.session.accessToken)); } catch (error) { next(error); }
});
app.use('/api', (_req, res) => apiError(res, 404, 'API_ROUTE_NOT_FOUND', 'This API route does not exist.'));
app.use((error, _req, res, _next) => {
  if (res.headersSent) return res.end();
  const id = crypto.randomUUID();
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = error?.type === 'entity.parse.failed' ? 'INVALID_JSON' : status === 413 ? 'REQUEST_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : status >= 500 ? 'DOCUMENT_REQUEST_FAILED' : 'REQUEST_FAILED';
  const message = error?.publicMessage || (error?.type === 'entity.parse.failed' ? 'Request body must contain valid JSON.' : status === 413 ? 'This request is too large.' : status < 500 ? (error?.message || 'The request could not be completed.') : 'The document request failed. Please try again.');
  console.error(`request=${id} type=${error?.name || 'Error'}`);
  return res.status(status).json({ ok: false, error: { code, message }, requestId: id });
});
export default app;

if (!config.vercel) {
  logEnvironmentCheck();
  app.listen(config.port, config.host, () => console.log(`Private Story Reader API listening on ${config.host}:${config.port}`));
}
