import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { graphShareId, publicAddress, validShareUrl } from './security.mjs';

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 8787);
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';
const MAX_BYTES = 40 * 1024 * 1024;
const isConfigured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.SESSION_SECRET);
const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
const msal = isConfigured ? new ConfidentialClientApplication({ auth: { clientId: process.env.MICROSOFT_CLIENT_ID, authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}`, clientSecret: process.env.MICROSOFT_CLIENT_SECRET } }) : null;
const scopes = ['User.Read', 'Files.Read'];

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'", 'https://login.microsoftonline.com'] } }, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use((req, res, next) => {
  if (req.headers.origin && req.headers.origin !== APP_ORIGIN) return res.status(403).json({ error: 'This request origin is not allowed.' });
  if (req.method === 'POST' && req.headers.origin !== APP_ORIGIN) return res.status(403).json({ error: 'Request origin validation failed.' });
  res.setHeader('Cache-Control', 'no-store'); next();
});
app.use(express.json({ limit: '8kb', type: 'application/json' }));
app.use(session({ name: 'psr.sid', secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 } }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

async function downloadPinned(urlString) {
  const url = new URL(urlString);
  const allowed = ['sharepoint.com', '1drv.com', 'onedrive.live.com', 'blob.core.windows.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || !allowed || url.port) throw new Error('Microsoft returned an unsupported download location.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) throw new Error('The document host resolved to a restricted network address.');
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: url.hostname, path: `${url.pathname}${url.search}`, servername: url.hostname, lookup: (_host, _opts, callback) => callback(null, addresses[0].address, net.isIPv4(addresses[0].address) ? 4 : 6), timeout: 20_000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('The document could not be downloaded from Microsoft.')); return; }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_BYTES) { response.destroy(); reject(new Error('This document is larger than the 40 MB limit.')); return; }
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > MAX_BYTES) { response.destroy(new Error('This document is larger than the 40 MB limit.')); return; } chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Microsoft document download timed out.')));
    request.on('error', reject);
  });
}
function requireConfigured(req, res, next) { if (!msal) return res.status(503).json({ error: 'Microsoft sign-in is not configured on this server.' }); next(); }

app.get('/api/health', (_req, res) => res.json({ ok: true, microsoftConfigured: isConfigured }));
app.get('/api/auth/status', (_req, res) => res.json({ authenticated: Boolean(_req.session.accessToken && _req.session.tokenExpiresAt > Date.now()), configured: isConfigured }));
app.get('/api/auth/login', requireConfigured, async (req, res, next) => {
  try { const state = crypto.randomBytes(32).toString('base64url'); const codeVerifier = crypto.randomBytes(32).toString('base64url'); const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url'); req.session.oauthState = state; req.session.codeVerifier = codeVerifier; const url = await msal.getAuthCodeUrl({ scopes, redirectUri, state, codeChallenge, codeChallengeMethod: 'S256', prompt: 'select_account' }); res.redirect(url); } catch (error) { next(error); }
});
app.get('/api/auth/callback', requireConfigured, async (req, res, next) => {
  const { code, state, error } = req.query;
  const expectedState = req.session.oauthState;
  if (error || typeof code !== 'string' || typeof state !== 'string' || !expectedState || Buffer.byteLength(state) !== Buffer.byteLength(expectedState) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) return res.status(400).send('Microsoft sign-in could not be completed. Return to the reader and try again.');
  delete req.session.oauthState;
  const codeVerifier = req.session.codeVerifier; delete req.session.codeVerifier;
  if (!codeVerifier) return res.status(400).send('Microsoft sign-in could not be completed. Return to the reader and try again.');
  try { const result = await msal.acquireTokenByCode({ code, scopes, redirectUri, codeVerifier }); req.session.accessToken = result.accessToken; req.session.tokenExpiresAt = result.expiresOn?.getTime() || Date.now() + 50 * 60_000; req.session.save(() => res.redirect(`${APP_ORIGIN}/?microsoftConnected=1`)); } catch (cause) { next(cause); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('psr.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }); res.json({ ok: true }); }));
async function getSharedDocument(url, accessToken) {
    const shareId = graphShareId(url);
    const metadataResponse = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem?$select=id,name,size,file`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (metadataResponse.status === 401) throw Object.assign(new Error('Your Microsoft session expired. Sign in again to continue.'), { status: 401 });
    if (metadataResponse.status === 403 || metadataResponse.status === 404) throw Object.assign(new Error('You don’t currently have permission to read this document.'), { status: 403 });
    if (!metadataResponse.ok) throw Object.assign(new Error('Microsoft could not open this sharing link.'), { status: 502 });
    const metadata = await metadataResponse.json();
    if (!metadata.file || !/\.(txt|md|markdown|pdf|docx|epub)$/i.test(metadata.name || '')) throw Object.assign(new Error('Choose a TXT, Markdown, PDF, DOCX, or EPUB document.'), { status: 415 });
    if (metadata.size > MAX_BYTES) throw Object.assign(new Error('This document is larger than the 40 MB limit.'), { status: 413 });
    const contentResponse = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const location = contentResponse.headers.get('location');
    if (contentResponse.status !== 302 || !location) throw Object.assign(new Error('Microsoft did not provide an accessible download for this document.'), { status: 502 });
    const bytes = await downloadPinned(location);
    return { bytes, name: metadata.name };
}
function sendDocument(res, document) { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', document.bytes.length); res.setHeader('X-Document-Name', encodeURIComponent(document.name)); res.send(document.bytes); }
app.post('/api/documents/shared', async (req, res, next) => {
  const { url } = req.body || {};
  if (!validShareUrl(url)) return res.status(400).json({ error: 'Paste an HTTPS OneDrive or SharePoint sharing link.' });
  if (!isConfigured) return res.status(503).json({ error: 'Microsoft sign-in is not configured on this server.' });
  if (!req.session.accessToken || req.session.tokenExpiresAt <= Date.now()) { req.session.pendingShareUrl = url; return res.status(401).json({ error: 'Sign in with Microsoft to open this document.' }); }
  try { const document = await getSharedDocument(url, req.session.accessToken); delete req.session.pendingShareUrl; sendDocument(res, document); }
  catch (error) { if (error.status === 401) { delete req.session.accessToken; req.session.pendingShareUrl = url; } next(error); }
});
app.post('/api/documents/pending', async (req, res, next) => {
  const url = req.session.pendingShareUrl;
  if (!url || !validShareUrl(url)) return res.status(404).json({ error: 'There is no pending document.' });
  if (!req.session.accessToken || req.session.tokenExpiresAt <= Date.now()) return res.status(401).json({ error: 'Sign in with Microsoft to open this document.' });
  delete req.session.pendingShareUrl;
  try { sendDocument(res, await getSharedDocument(url, req.session.accessToken)); } catch (error) { next(error); }
});
app.use((error, _req, res, _next) => { const id = crypto.randomUUID(); console.error(`request=${id} type=${error?.name || 'Error'}`); res.status(error.status || 500).json({ error: error.status ? error.message : 'The document request failed. Please try again.', requestId: id }); });
app.listen(PORT, '127.0.0.1', () => console.log(`Private Story Reader API listening on 127.0.0.1:${PORT}`));
