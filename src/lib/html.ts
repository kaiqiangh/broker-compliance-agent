/**
 * HTML escaping utilities to prevent XSS in document/email templates.
 */

/**
 * Escape a string for safe insertion into HTML content or attributes.
 * Handles &, <, >, ", ' and backtick.
 */
export function escapeHtml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;');
}
