/**
 * Extract the check-in token from a scanned QR value.
 *
 * The site QR encodes the public URL (…/check-in/{token} or …?token=…);
 * we accept either the full URL or a bare token. Pure function, no RN deps —
 * kept separate from QrScanner so it is unit-testable without the native
 * camera module.
 */
export function extractToken(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const urlMatch = value.match(/check-in\/([^/?#]+)/i);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]);
  const queryMatch = value.match(/[?&]token=([^&]+)/i);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
  return null;
}
