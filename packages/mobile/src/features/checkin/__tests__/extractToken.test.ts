import { extractToken } from '../extract-token';

describe('extractToken', () => {
  it('extracts a token from a full public check-in URL', () => {
    expect(extractToken('https://portal.example.com/check-in/abc123XYZ')).toBe('abc123XYZ');
  });

  it('extracts a token from a URL with a trailing slash/query', () => {
    expect(extractToken('https://x.com/check-in/tok_9/?foo=bar')).toBe('tok_9');
  });

  it('extracts a token from a ?token= query form', () => {
    expect(extractToken('https://x.com/checkin?token=qToken-1')).toBe('qToken-1');
  });

  it('accepts a bare token', () => {
    expect(extractToken('BARE_token.123')).toBe('BARE_token.123');
  });

  it('url-decodes an encoded token', () => {
    expect(extractToken('https://x.com/check-in/a%2Db')).toBe('a-b');
  });

  it('trims surrounding whitespace', () => {
    expect(extractToken('  https://x.com/check-in/tok  ')).toBe('tok');
  });

  it('returns null for empty input', () => {
    expect(extractToken('   ')).toBeNull();
  });

  it('returns null for a value with spaces that is not a URL', () => {
    expect(extractToken('not a token')).toBeNull();
  });
});
