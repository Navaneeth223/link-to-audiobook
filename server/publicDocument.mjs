import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { publicAddress, readableDocumentType } from './security.mjs';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 8_000;

function documentError(status, code, message) {
  return Object.assign(new Error(message), { status, publicMessage: message, publicCode: code });
}

function safeName(url, disposition, contentType) {
  const hinted = /filename\*?=(?:UTF-8''|"?)([^;"\r\n]+)/i.exec(disposition)?.[1]?.trim();
  let name = '';
  try {
    name = hinted ? decodeURIComponent(hinted.replace(/^"|"$/g, '')) : decodeURIComponent(url.pathname.split('/').pop() || '');
  } catch { /* Use the safe fallback name for malformed encoded filenames. */ }
  name = (name.split(/[\\/]/).pop() || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
  if (/\.(txt|md|markdown|pdf|docx|epub)$/i.test(name)) return name;
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  const extension = mime === 'application/pdf' ? '.pdf' : ['text/plain', 'text/markdown'].includes(mime) ? '.txt' : '';
  return `document${extension}`;
}

async function resolvePublicAddresses(hostname, lookup, remainingMs) {
  let addresses;
  let timer;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(documentError(504, 'REMOTE_TIMEOUT', 'The document host took too long to resolve.')), remainingMs); }),
    ]);
  }
  catch (error) {
    if (error.status) throw error;
    throw documentError(502, 'REMOTE_HOST_UNAVAILABLE', 'The document host could not be reached.');
  }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw documentError(400, 'URL_TARGET_NOT_PUBLIC', 'This URL resolves to a private or restricted network address.');
  }
  return addresses;
}

function requestOnce(url, addresses, timeoutMs) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let request;
    const absoluteTimeout = setTimeout(() => request?.destroy(documentError(504, 'REMOTE_TIMEOUT', 'The document server took too long to respond.')), timeoutMs);
    request = transport.get({
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      headers: { Accept: 'text/plain, text/markdown, application/pdf, application/octet-stream;q=0.8', 'User-Agent': 'PrivateStoryReader/1.0 (+document reader)' },
      lookup: (_hostname, options, callback) => {
        const address = addresses[0];
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      timeout: timeoutMs,
    }, response => {
      clearTimeout(absoluteTimeout);
      resolve(response);
    });
    request.on('timeout', () => request.destroy(documentError(504, 'REMOTE_TIMEOUT', 'The document server took too long to respond.')));
    request.on('error', error => {
      clearTimeout(absoluteTimeout);
      if (error.status) return reject(error);
      if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code)) return reject(documentError(504, 'REMOTE_TIMEOUT', 'The document server took too long to respond.'));
      const failure = documentError(502, 'REMOTE_CONNECTION_FAILED', 'The document host could not be reached.');
      failure.causeCode = error.code;
      reject(failure);
    });
  });
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers['content-length'] || 0);
  if (declared > maxBytes) {
    response.destroy();
    throw documentError(413, 'DOCUMENT_TOO_LARGE', `This document is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response) {
    length += chunk.length;
    if (length > maxBytes) {
      response.destroy();
      throw documentError(413, 'DOCUMENT_TOO_LARGE', `This document is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function fetchPublicDocument(input, maxBytes, { lookup = dns.lookup, request = requestOnce } = {}) {
  let url;
  try { url = new URL(input); }
  catch { throw documentError(400, 'URL_INVALID', 'Enter a valid document URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096) {
    throw documentError(400, 'URL_INVALID', 'Use a valid HTTP or HTTPS document URL without credentials or a custom port.');
  }
  if (url.hostname === 'onedrive.live.com' && url.pathname === '/' && !url.search) {
    throw documentError(400, 'ONEDRIVE_LINK_INVALID', 'That is the OneDrive homepage. Open the document, choose “Copy link,” then paste its sharing link here.');
  }
  const deadline = Date.now() + TIMEOUT_MS;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw documentError(504, 'REMOTE_TIMEOUT', 'The document request took too long.');
    const addresses = await resolvePublicAddresses(url.hostname, lookup, remainingMs);
    const response = await request(url, addresses, Math.max(1, deadline - Date.now()));
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location) throw documentError(502, 'REDIRECT_INVALID', 'The document server returned an invalid redirect.');
      if (redirectCount === MAX_REDIRECTS) throw documentError(502, 'TOO_MANY_REDIRECTS', 'The document server redirected too many times.');
      try { url = new URL(location, url); }
      catch { throw documentError(502, 'REDIRECT_INVALID', 'The document server returned an invalid redirect.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
        throw documentError(400, 'REDIRECT_NOT_ALLOWED', 'The document server redirected to an unsupported address.');
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      const status = response.statusCode;
      const code = status === 403 ? 'REMOTE_FORBIDDEN' : status === 404 ? 'REMOTE_NOT_FOUND' : status >= 500 ? 'REMOTE_SERVER_ERROR' : 'REMOTE_HTTP_ERROR';
      const message = status === 403 ? 'The document server denied access to this URL.' : status === 404 ? 'The document was not found at this URL.' : `The document server returned HTTP ${status}.`;
      throw documentError(status >= 500 ? 502 : status, code, message);
    }
    const contentType = String(response.headers['content-type'] || '');
    const disposition = String(response.headers['content-disposition'] || '');
    let timeout;
    const bytes = await Promise.race([
      readLimited(response, maxBytes),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          response.destroy();
          reject(documentError(504, 'REMOTE_TIMEOUT', 'The document download took too long.'));
        }, Math.max(1, deadline - Date.now()));
      }),
    ]).finally(() => clearTimeout(timeout));
    const name = safeName(url, disposition, contentType);
    if (!readableDocumentType(bytes, { name, contentType, disposition })) {
      throw documentError(415, 'UNSUPPORTED_DOCUMENT', 'This URL did not return a supported TXT, Markdown, PDF, DOCX, or EPUB document.');
    }
    return { bytes, name };
  }
  throw documentError(502, 'TOO_MANY_REDIRECTS', 'The document server redirected too many times.');
}
