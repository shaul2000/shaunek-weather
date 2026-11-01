import { applySavedTheme } from './preferences.js';

applySavedTheme();

export const $ = (selector) => document.querySelector(selector);
export const API_BASE = (window.SHAUNEK_API_BASE_URL || '').replace(/\/$/, '');

let csrfToken = null;

export async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  // State-changing requests must carry the session's CSRF token.
  if (options.method && options.method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function loadCsrf() {
  const data = await api('/api/csrf');
  if (typeof data?.csrfToken !== 'string' || !data.csrfToken) {
    throw new Error('Could not load a security token. Please try again.');
  }
  csrfToken = data.csrfToken;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}
