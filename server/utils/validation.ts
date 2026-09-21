/**
 * Server-side input validation and error-sanitisation helpers.
 */

export const VALID_SYMBOL_REGEX = /^[A-Z0-9_]{2,30}$/;

export function sanitizeSymbol(symbol: string | undefined): string | null {
  if (!symbol) return null;
  const cleaned = String(symbol).toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return VALID_SYMBOL_REGEX.test(cleaned) ? cleaned : null;
}

/**
 * Never leak absolute filesystem paths (or internal details) to API clients in
 * production builds.
 */
export function sanitizeErrorMessage(error: any): string {
  if (process.env.NODE_ENV === 'production') {
    return 'An internal error occurred. Please try again.';
  }
  const msg = error?.message || 'Unknown error';
  return msg.replace(/\b[A-Z]:\\[^\s]+/gi, '[path]').substring(0, 200);
}
