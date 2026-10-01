import { describe, expect, it } from 'vitest';
import { responseErrorMessage } from './http';

describe('shared link API errors', () => {
  it('uses a readable API error when JSON is present', async () => {
    const response = new Response(JSON.stringify({ error: 'Microsoft sign-in is not configured.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    expect(await responseErrorMessage(response, 'Could not open file.')).toBe('Microsoft sign-in is not configured.');
  });
  it('understands the structured API error envelope', async () => {
    const response = Response.json({ ok: false, error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in with Microsoft first.' } }, { status: 401 });
    expect(await responseErrorMessage(response, 'Could not open file.')).toBe('Sign in with Microsoft first.');
  });
  it('handles empty, invalid JSON, and HTML proxy responses without throwing', async () => {
    const empty = new Response(null, { status: 500 });
    const html = new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    const malformed = new Response('{', { status: 500, headers: { 'Content-Type': 'application/json' } });
    expect(await responseErrorMessage(empty, 'Could not open file.')).toContain('Check status');
    expect(await responseErrorMessage(html, 'Could not open file.')).toContain('Check status');
    expect(await responseErrorMessage(malformed, 'Could not open file.')).toContain('Check status');
  });
});
