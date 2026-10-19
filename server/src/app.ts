import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import fastify from 'fastify';
import type { AIProvider } from './ai/AIProvider.js';
import { GeminiProvider } from './ai/gemini-provider.js';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { publicMessages } from './lib/errors.js';
import { PublicError } from './lib/errors.js';
import { decodeCanonicalLocalClientToken } from './lib/local-client-token.js';
import { registerAnalyzeRoute } from './routes/analyze.js';

export interface BuildAppOptions {
  config?: AppConfig;
  provider?: AIProvider;
  loggerStream?: NodeJS.WritableStream;
  now?: () => number;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  if (!options.provider && !config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for the Gemini provider');
  }
  const logger = {
    redact: [
      'req.body',
      'res.body',
      'req.headers.authorization',
      'req.headers.x-local-client-token',
      'headers.authorization',
      'headers.x-local-client-token',
      '*.GEMINI_API_KEY',
      '*.LOCAL_CLIENT_TOKEN'
    ],
    ...(options.loggerStream ? { stream: options.loggerStream as any } : {}),
    serializers: {
      req(request: any) {
        const url = typeof request.routeOptions?.url === 'string'
          ? request.routeOptions.url
          : request.url?.split('?', 1)[0];
        return { id: request.id, method: request.method, url, remoteAddress: request.ip };
      },
      res(reply: any) { return { statusCode: reply.statusCode }; }
    }
  };
  const app = fastify({
    bodyLimit: 6 * 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
    ajv: { customOptions: { removeAdditional: false } },
    logger
  });
  const provider = options.provider ?? buildProvider(config, app.log);

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      callback(null, config.EXTENSION_ORIGINS.includes(origin));
    },
    methods: ['POST'],
    allowedHeaders: ['Content-Type', 'X-Local-Client-Token'],
    credentials: false
  });
  const rateLimitBySource = new Map<string, { count: number; resetAt: number }>();
  const rateLimitWindowMs = config.RATE_LIMIT_WINDOW_MS;
  app.addHook('onRequest', async (request) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/api/analyze') return;
    if (!isAuthorizedAnalyzeRequest(request.headers.origin, request.headers['x-local-client-token'], config)) {
      throw new PublicError('FORBIDDEN', publicMessages.FORBIDDEN, 403);
    }
    const now = options.now?.() ?? Date.now();
    for (const [key, candidate] of rateLimitBySource) {
      if (candidate.resetAt <= now) rateLimitBySource.delete(key);
    }
    const key = `${request.ip}:${request.routeOptions.url}`;
    const entry = rateLimitBySource.get(key);
    if (!entry || entry.resetAt <= now) {
      if (rateLimitBySource.size >= config.RATE_LIMIT_MAX_ENTRIES) {
        const oldestKey = rateLimitBySource.keys().next().value as string | undefined;
        if (oldestKey) rateLimitBySource.delete(oldestKey);
      }
      rateLimitBySource.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > config.RATE_LIMIT_MAX) {
      throw new PublicError('RATE_LIMITED', publicMessages.RATE_LIMITED, 429);
    }
  });

  app.setErrorHandler((error: any, _request, reply) => {
    if (error instanceof PublicError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error.validation) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: publicMessages.BAD_REQUEST } });
    if (error.statusCode === 429 || error.code === 'FST_ERR_RATE_LIMIT' || String(error.message).toLowerCase().includes('rate limit')) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: publicMessages.RATE_LIMITED } });
    }
    if (error.statusCode === 413) return reply.status(413).send({ error: { code: 'IMAGE_TOO_LARGE', message: publicMessages.IMAGE_TOO_LARGE } });
    return reply.status(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: publicMessages.SERVICE_UNAVAILABLE } });
  });

  await registerAnalyzeRoute(app as any, provider, config);
  return app;
}

function isAuthorizedAnalyzeRequest(
  origin: string | undefined,
  tokenHeader: string | string[] | undefined,
  config: AppConfig
): boolean {
  if (!origin || !config.EXTENSION_ORIGINS.includes(origin) || typeof tokenHeader !== 'string') return false;
  const candidate = decodeCanonicalLocalClientToken(tokenHeader);
  return candidate !== undefined
    && candidate.byteLength === config.LOCAL_CLIENT_TOKEN_BYTES.byteLength
    && timingSafeEqual(candidate, config.LOCAL_CLIENT_TOKEN_BYTES);
}

function buildProvider(config: AppConfig, logger: { info: (entry: object, message: string) => void }): AIProvider {
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for the Gemini provider');
  return new GeminiProvider({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
    logger: (entry) => logger.info(entry, 'gemini provider attempt')
  });
}
