export const tinyJpegDataUrl = 'data:image/jpeg;base64,/9j/2Q==';
export const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
export const testExtensionOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const testLocalClientToken = 'paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaU';
export const testLocalClientTokenAlias = 'paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaV';
export const authorizedHeaders = {
  origin: testExtensionOrigin,
  'x-local-client-token': testLocalClientToken
};

export function jpegDataUrl(byteLength: number): string {
  if (byteLength < 4) throw new Error('JPEG fixture must be at least 4 bytes');
  const bytes = Buffer.alloc(byteLength, 0);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[byteLength - 2] = 0xff;
  bytes[byteLength - 1] = 0xd9;
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    EXTENSION_ORIGINS: testExtensionOrigin,
    LOCAL_CLIENT_TOKEN: testLocalClientToken,
    GEMINI_MODEL: 'gemini-flash-lite-latest',
    GEMINI_API_KEY: 'test-key',
    RATE_LIMIT_MAX: '100',
    ...overrides
  } as NodeJS.ProcessEnv;
}
