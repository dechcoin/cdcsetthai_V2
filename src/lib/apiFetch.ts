import { STORAGE_KEYS } from '../constants/storageKeys';

/**
 * Shared fetch wrapper that attaches the dashboard auth token to every
 * same-origin /api/* request, so the server can reject unauthenticated callers
 * when DASHBOARD_TOKEN is configured.
 */

export function getDashboardToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.DASHBOARD_TOKEN) || '';
  } catch {
    return '';
  }
}

export function setDashboardToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.DASHBOARD_TOKEN);
    }
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Returns a HeadersInit merged with the auth token (if present).
 */
export function apiHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extra)) {
      extra.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, extra);
    }
  }
  const token = getDashboardToken();
  if (token) {
    headers['x-dashboard-token'] = token;
  }
  return headers;
}

/**
 * Drop-in replacement for fetch() used for internal API calls.
 */
export async function apiFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: apiHeaders(init.headers),
  });
}
