import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { fetchPublicDocument } from './publicDocument.mjs';

const MAX_BYTES = 1024 * 1024;
const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
function response(statusCode: number, bytes = '', headers: Record<string, string> = {}) {
  const stream = Readable.from(bytes ? [Buffer.from(bytes)] : []);
  return Object.assign(stream, { statusCode, headers });
}

describe('fetchPublicDocument', () => {
  it('accepts public plain text documents', async () => {
    const request = vi.fn(async () => response(200, 'A readable story.', { 'content-type': 'text/plain' }));
    const result = await fetchPublicDocument('https://stories.example/story.txt', MAX_BYTES, { lookup: publicLookup, request });
    expect(result.name).toBe('story.txt');
    expect(result.bytes.toString()).toBe('A readable story.');
  });

  it('accepts PDF documents by signature', async () => {
    const request = vi.fn(async () => response(200, '%PDF-1.7\ncontent', { 'content-type': 'application/pdf' }));
    const result = await fetchPublicDocument('https://stories.example/book', MAX_BYTES, { lookup: publicLookup, request });
    expect(result.name).toBe('document.pdf');
  });

  it('rejects malformed and unsupported URLs', async () => {
    await expect(fetchPublicDocument('not a URL', MAX_BYTES)).rejects.toMatchObject({ status: 400, publicCode: 'URL_INVALID' });
    await expect(fetchPublicDocument('file:///etc/passwd', MAX_BYTES)).rejects.toMatchObject({ status: 400, publicCode: 'URL_INVALID' });
  });

  it('tells users the OneDrive homepage is not a document link', async () => {
    await expect(fetchPublicDocument('https://onedrive.live.com/', MAX_BYTES)).rejects.toMatchObject({ status: 400, publicCode: 'ONEDRIVE_LINK_INVALID' });
  });

  it('rejects a target resolving to a private address', async () => {
    await expect(fetchPublicDocument('http://internal.example/story.txt', MAX_BYTES, {
      lookup: vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
    })).rejects.toMatchObject({ status: 400, publicCode: 'URL_TARGET_NOT_PUBLIC' });
  });

  it('reports remote HTTP errors', async () => {
    await expect(fetchPublicDocument('https://stories.example/missing.txt', MAX_BYTES, {
      lookup: publicLookup,
      request: vi.fn(async () => response(404)),
    })).rejects.toMatchObject({ status: 404, publicCode: 'REMOTE_NOT_FOUND' });
  });

  it('rejects ordinary HTML pages as unsupported documents', async () => {
    await expect(fetchPublicDocument('https://stories.example/', MAX_BYTES, {
      lookup: publicLookup,
      request: vi.fn(async () => response(200, '<!doctype html><html></html>', { 'content-type': 'text/html' })),
    })).rejects.toMatchObject({ status: 415, publicCode: 'UNSUPPORTED_DOCUMENT' });
  });

  it('follows redirects and revalidates the target host', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response(302, '', { location: 'https://cdn.example/story.txt' }))
      .mockResolvedValueOnce(response(200, 'Redirected text.', { 'content-type': 'text/plain' }));
    await fetchPublicDocument('https://stories.example/start', MAX_BYTES, { lookup: publicLookup, request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(publicLookup).toHaveBeenCalledWith('cdn.example', { all: true, verbatim: true });
  });

  it('enforces the byte limit even without Content-Length', async () => {
    await expect(fetchPublicDocument('https://stories.example/story.txt', 8, {
      lookup: publicLookup,
      request: vi.fn(async () => response(200, 'This is too large.', { 'content-type': 'text/plain' })),
    })).rejects.toMatchObject({ status: 413, publicCode: 'DOCUMENT_TOO_LARGE' });
  });

  it('handles request timeouts as a structured error', async () => {
    await expect(fetchPublicDocument('https://stories.example/story.txt', MAX_BYTES, {
      lookup: publicLookup,
      request: vi.fn(async () => { throw Object.assign(new Error('timeout'), { status: 504, publicCode: 'REMOTE_TIMEOUT' }); }),
    })).rejects.toMatchObject({ status: 504, publicCode: 'REMOTE_TIMEOUT' });
  });
});
