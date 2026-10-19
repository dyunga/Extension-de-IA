import { describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import {
  DEFAULT_AI_TIMEOUT_MS,
  MAX_AI_TIMEOUT_MS,
  MAX_RATE_LIMIT_MAX,
  MAX_RATE_LIMIT_MAX_ENTRIES,
  MAX_RATE_LIMIT_WINDOW_MS,
  loadConfig
} from '../src/config.js';
import type { AIProvider } from '../src/ai/AIProvider.js';
import {
  authorizedHeaders,
  jpegDataUrl,
  testEnv,
  testExtensionOrigin,
  testLocalClientToken,
  testLocalClientTokenAlias,
  tinyJpegDataUrl
} from './fixtures.js';

function provider(result = '1: A · 2: C'): AIProvider & { analyzeImage: ReturnType<typeof vi.fn> } {
  return { analyzeImage: vi.fn(async () => result) };
}

function captureLogs(): { stream: Writable; read: () => string } {
  let logs = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      }
    }),
    read: () => logs
  };
}

function expectSafeFailureEvidence(response: { body: string }, logs: string, forbiddenValues: string[]): void {
  const clientBody = response.body;
  const combinedEvidence = `${clientBody}\n${logs}`;

  expect(clientBody).not.toContain('stack');
  expect(clientBody).not.toContain('GEMINI_API_KEY');

  for (const value of forbiddenValues) {
    expect(combinedEvidence).not.toContain(value);
  }
}

describe('POST /api/analyze', () => {
  it('parses TRUST_PROXY strictly and validates server-only Gemini env safely', async () => {
    expect(loadConfig(testEnv({ TRUST_PROXY: 'false' })).TRUST_PROXY).toBe(false);
    expect(loadConfig(testEnv({ TRUST_PROXY: 'true' })).TRUST_PROXY).toBe(true);
    const defaultModelEnv = testEnv();
    delete defaultModelEnv.GEMINI_MODEL;
    expect(loadConfig(defaultModelEnv).GEMINI_MODEL).toBe('gemini-flash-lite-latest');
    expect(loadConfig(testEnv()).AI_TIMEOUT_MS).toBe(45_000);
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(45_000);
    expect(MAX_AI_TIMEOUT_MS).toBe(45_000);
    expect(loadConfig(testEnv({ AI_TIMEOUT_MS: '45000' })).AI_TIMEOUT_MS).toBe(45_000);
    expect(() => loadConfig(testEnv({ AI_TIMEOUT_MS: '45001' }))).toThrow();
    expect(() => loadConfig(testEnv({ TRUST_PROXY: 'yes' }))).toThrow();
    expect(() => loadConfig(testEnv({ GEMINI_MODEL: '' }))).toThrow();
    expect(() => loadConfig(testEnv({ GEMINI_API_KEY: '' }))).toThrow();
    expect(() => loadConfig(testEnv({ HOST: '0.0.0.0' }))).toThrow();
    expect(() => loadConfig(testEnv({ LOCAL_CLIENT_TOKEN: 'too-short' }))).toThrow();
    expect(() => loadConfig(testEnv({ LOCAL_CLIENT_TOKEN: testLocalClientTokenAlias }))).toThrow(/canonical/);
    expect(loadConfig(testEnv({ RATE_LIMIT_WINDOW: '1 minute' })).RATE_LIMIT_WINDOW_MS).toBe(60_000);
    for (const value of ['', '0', '0 ms', '-1 ms', 'not-a-duration', `${MAX_RATE_LIMIT_WINDOW_MS + 1} ms`, '999999999999999999999999999999 minutes']) {
      expect(() => loadConfig(testEnv({ RATE_LIMIT_WINDOW: value }))).toThrow(/RATE_LIMIT_WINDOW/);
    }
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX: String(MAX_RATE_LIMIT_MAX + 1) }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX: 'Infinity' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX: 'not-a-number' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX: '0' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX: '-1' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX_ENTRIES: String(MAX_RATE_LIMIT_MAX_ENTRIES + 1) }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX_ENTRIES: 'Infinity' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX_ENTRIES: 'not-a-number' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX_ENTRIES: '0' }))).toThrow();
    expect(() => loadConfig(testEnv({ RATE_LIMIT_MAX_ENTRIES: '-1' }))).toThrow();

    const missingKeyEnv = testEnv();
    delete missingKeyEnv.GEMINI_API_KEY;
    await expect(buildApp({ config: loadConfig(missingKeyEnv) })).rejects.toThrow('GEMINI_API_KEY');
  });

  it('validates a JPEG data URL and substitutes providers through the AIProvider contract', async () => {
    const fake = provider('1: A · 2: C');
    const app = await buildApp({ config: loadConfig(testEnv()), provider: fake });
    const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: '1: A · 2: C' });
    expect(fake.analyzeImage).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects unknown fields and malformed images before provider invocation', async () => {
    const fake = provider();
    const app = await buildApp({ config: loadConfig(testEnv()), provider: fake });
    const extra = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl, extra: true } });
    const malformed = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: 'data:image/jpeg;base64,abc' } });
    expect(extra.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(fake.analyzeImage).not.toHaveBeenCalled();
    await app.close();
  });

  it('enforces decoded image limits before provider analysis and caps long non-questionnaire responses', async () => {
    const words = Array.from({ length: 70 }, (_, index) => `palabra${index}`).join(' ');
    const fake = provider(words);
    const app = await buildApp({ config: loadConfig(testEnv({ MAX_IMAGE_BYTES: '8', RATE_LIMIT_MAX: '1000' })), provider: fake });
    const ok = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    expect((ok.json().message as string).split(/\s+/)).toHaveLength(60);
    const tooLarge = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: jpegDataUrl(9) } });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe('IMAGE_TOO_LARGE');
    expect(fake.analyzeImage).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects encoded requests over the Fastify body limit before provider analysis', async () => {
    const fake = provider();
    const app = await buildApp({ config: loadConfig(testEnv({ MAX_IMAGE_BYTES: String(8 * 1024 * 1024) })), provider: fake });
    const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: jpegDataUrl(4_800_000) } });
    expect(response.statusCode).toBe(413);
    expect(fake.analyzeImage).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns CORS only for exact configured extension origins', async () => {
    const app = await buildApp({ config: loadConfig(testEnv()), provider: provider() });
    const allowed = await app.inject({ method: 'OPTIONS', url: '/api/analyze', headers: { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-local-client-token' } });
    const denied = await app.inject({ method: 'OPTIONS', url: '/api/analyze', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(allowed.headers['access-control-allow-headers']).toContain('X-Local-Client-Token');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('requires the exact extension origin and local token before provider work with one safe response', async () => {
    const fake = provider();
    const app = await buildApp({ config: loadConfig(testEnv()), provider: fake });
    const attempts = [
      {},
      { origin: testExtensionOrigin },
      { origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'x-local-client-token': testLocalClientToken },
      { origin: testExtensionOrigin, 'x-local-client-token': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      { origin: testExtensionOrigin, 'x-local-client-token': testLocalClientTokenAlias }
    ];

    const responses = await Promise.all(attempts.map((headers) => app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers,
      payload: { imageDataUrl: tinyJpegDataUrl }
    })));

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'La solicitud no está autorizada.' } });
    }
    expect(fake.analyzeImage).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unauthorized malformed and oversized bodies with the same safe 403 before provider work', async () => {
    const fake = provider();
    const app = await buildApp({ config: loadConfig(testEnv()), provider: fake });
    const unauthorizedHeaders = {
      origin: testExtensionOrigin,
      'x-local-client-token': testLocalClientTokenAlias,
      'content-type': 'application/json'
    };
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: unauthorizedHeaders,
      payload: '{"imageDataUrl":'
    });
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: unauthorizedHeaders,
      payload: `{"imageDataUrl":"${'A'.repeat(6 * 1024 * 1024)}"}`
    });

    for (const response of [malformed, oversized]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'La solicitud no está autorizada.' } });
    }
    expect(fake.analyzeImage).not.toHaveBeenCalled();
    await app.close();
  });

  it('sanitizes provider failures', async () => {
    const failing = { analyzeImage: vi.fn(async () => { throw new Error('secret provider details'); }) };
    const app = await buildApp({ config: loadConfig(testEnv()), provider: failing });
    const first = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    expect(first.statusCode).toBe(503);
    expect(JSON.stringify(first.json())).not.toContain('secret');
    await app.close();
  });

  it('cleans up the request deadline when the provider throws synchronously', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', recordUnhandled);
    const syncFailing: AIProvider = { analyzeImage: vi.fn(() => { throw new Error('sync secret provider details'); }) as unknown as AIProvider['analyzeImage'] };
    const app = await buildApp({ config: loadConfig(testEnv({ AI_TIMEOUT_MS: '10' })), provider: syncFailing });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'El servicio no está disponible ahora.' } });
      expect(response.body).not.toContain('sync secret');
      expect(vi.getTimerCount()).toBe(0);
      await Promise.resolve();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', recordUnhandled);
      vi.useRealTimers();
      await app.close();
    }
  });

  it('does not expose rejected request contents in client errors or logs', async () => {
    const fake = provider();
    const { stream, read } = captureLogs();
    const app = await buildApp({ config: loadConfig(testEnv({ GEMINI_API_KEY: 'AIza-request-secret' })), provider: fake, loggerStream: stream });
    const base64Payload = 'YWJjZA==';
    const screenshotDataUrl = `data:image/jpeg;base64,${base64Payload}`;
    const apiKeyMarker = 'AIza-request-secret';

    const response = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { ...authorizedHeaders, authorization: `Bearer ${apiKeyMarker}` },
      payload: { imageDataUrl: screenshotDataUrl, apiKey: apiKeyMarker, note: 'visible request content' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'La solicitud no es válida.' } });
    expect(fake.analyzeImage).not.toHaveBeenCalled();
    await app.close();
    expectSafeFailureEvidence(response, read(), [screenshotDataUrl, base64Payload, apiKeyMarker, testLocalClientToken, 'visible request content']);
  });

  it('does not expose provider failure details, screenshot data, or API keys in client errors or logs', async () => {
    const providerSecret = 'gemini-internal-trace-123';
    const apiKeyMarker = 'AIza-provider-secret';
    const failing = {
      analyzeImage: vi.fn(async () => {
        throw new Error(`${providerSecret} ${apiKeyMarker} ${tinyJpegDataUrl}`);
      })
    };
    const { stream, read } = captureLogs();
    const app = await buildApp({ config: loadConfig(testEnv({ GEMINI_API_KEY: apiKeyMarker })), provider: failing, loggerStream: stream });

    const emptyProvider = { analyzeImage: vi.fn(async () => '') };
    const emptyApp = await buildApp({ config: loadConfig(testEnv()), provider: emptyProvider });
    const emptyResponse = await emptyApp.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    expect(emptyResponse.statusCode).toBe(503);
    expect(emptyResponse.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'El servicio no está disponible ahora.' } });
    await emptyApp.close();

    const response = await app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'El servicio no está disponible ahora.' } });
    await app.close();
    expectSafeFailureEvidence(response, read(), [tinyJpegDataUrl, tinyJpegDataUrl.split(',')[1] ?? '', apiKeyMarker, providerSecret]);
  });

  it('enforces a request deadline even when the provider ignores AbortSignal and settles late', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', recordUnhandled);
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    const late = vi.fn(async () => new Promise<string>((resolve, reject) => {
      markProviderStarted();
      setTimeout(() => {
        reject(new Error('late secret failure'));
      }, 40);
      setTimeout(() => resolve('late result'), 80);
    }));
    const app = await buildApp({ config: loadConfig(testEnv({ AI_TIMEOUT_MS: '10' })), provider: { analyzeImage: late } });
    try {
      const responsePromise = app.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
      await providerStarted;
      await vi.advanceTimersByTimeAsync(10);
      const response = await responsePromise;
      expect(response.statusCode).toBe(504);
      expect(response.json()).toEqual({ error: { code: 'TIMEOUT', message: 'El análisis tardó demasiado.' } });
      await vi.advanceTimersByTimeAsync(70);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', recordUnhandled);
      vi.useRealTimers();
      await app.close();
    }
  });

  it('rate limits by source before provider analysis', async () => {
    const fake = provider('A');
    const app = await buildApp({ config: loadConfig(testEnv({ RATE_LIMIT_MAX: '1' })), provider: fake });
    const first = await app.inject({ method: 'POST', url: '/api/analyze?attempt=1', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    const second = await app.inject({ method: 'POST', url: '/api/analyze?attempt=2', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
    expect(fake.analyzeImage).toHaveBeenCalledOnce();
    await app.close();
  });

  it('bounds limiter state while pruning expired sources', async () => {
    const fake = provider('A');
    const app = await buildApp({
      config: loadConfig(testEnv({ TRUST_PROXY: 'true', RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW: '1 minute', RATE_LIMIT_MAX_ENTRIES: '2' })),
      provider: fake
    });
    const requestFrom = (ip: string) => app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { ...authorizedHeaders, 'x-forwarded-for': ip },
      payload: { imageDataUrl: tinyJpegDataUrl }
    });

    expect((await requestFrom('192.0.2.1')).statusCode).toBe(200);
    expect((await requestFrom('192.0.2.2')).statusCode).toBe(200);
    expect((await requestFrom('192.0.2.3')).statusCode).toBe(200);
    expect((await requestFrom('192.0.2.2')).statusCode).toBe(429);
    expect((await requestFrom('192.0.2.1')).statusCode).toBe(200);
    await app.close();

    let now = 1_000;
    const expiringApp = await buildApp({
      config: loadConfig(testEnv({ RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW: '10 ms', RATE_LIMIT_MAX_ENTRIES: '2' })),
      provider: fake,
      now: () => now
    });
    expect((await expiringApp.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } })).statusCode).toBe(200);
    now += 10;
    expect((await expiringApp.inject({ method: 'POST', url: '/api/analyze', headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } })).statusCode).toBe(200);
    await expiringApp.close();
  });

  it('logs safe metadata without screenshot data URLs or provider output', async () => {
    const { stream, read } = captureLogs();
    const fake = provider('respuesta secreta del modelo');
    const app = await buildApp({ config: loadConfig(testEnv()), provider: fake, loggerStream: stream });
    const queryMarker = 'query-secret-marker-123';
    await app.inject({ method: 'POST', url: `/api/analyze?token=${queryMarker}`, headers: authorizedHeaders, payload: { imageDataUrl: tinyJpegDataUrl } });
    await app.close();
    const logs = read();
    expect(logs).toContain('imageBytes');
    expect(logs).toContain('/api/analyze');
    expect(logs).not.toContain(queryMarker);
    expect(logs).not.toContain(tinyJpegDataUrl);
    expect(logs).not.toContain('respuesta secreta');
  });
});
