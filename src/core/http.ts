export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  let body = '';
  try { body = await response.clone().text(); } catch { /* The response may have no readable body. */ }
  if (body.trim()) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const error = parsed.error;
        if (typeof error === 'string' && error.trim()) return error;
        if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) return error.message;
      }
    } catch { /* HTML and plain text error pages are handled below. */ }
  }
  if (response.status === 401) return 'Sign in with Microsoft to open this document.';
  if (response.status === 403) return 'You don’t currently have permission to read this document.';
  if (response.status === 404 || response.status === 500 || response.status === 502 || response.status === 503) return 'The document service is unavailable. Check that the reader API is running and configured, then try again.';
  return fallback;
}
