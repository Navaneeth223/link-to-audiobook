const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: 'include', ...init });
}

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
  if (response.status === 415) return 'This link does not point to a readable TXT, Markdown, PDF, DOCX, or EPUB document.';
  if (response.status === 404) return 'The requested reader API route was not found.';
  if (response.status >= 500) return `The reader API returned HTTP ${response.status}. Check the API server output for the cause.`;
  return fallback;
}
