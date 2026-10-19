const LOCAL_CLIENT_TOKEN_BYTES = 32;
const LOCAL_CLIENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCanonicalLocalClientToken(value: string): boolean {
  if (!LOCAL_CLIENT_TOKEN_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === LOCAL_CLIENT_TOKEN_BYTES && decoded.toString('base64url') === value;
}
