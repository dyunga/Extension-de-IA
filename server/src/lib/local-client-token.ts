const LOCAL_CLIENT_TOKEN_BYTES = 32;
const LOCAL_CLIENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function decodeCanonicalLocalClientToken(value: string): Buffer | undefined {
  if (!LOCAL_CLIENT_TOKEN_PATTERN.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== LOCAL_CLIENT_TOKEN_BYTES || decoded.toString('base64url') !== value) return undefined;
  return decoded;
}
