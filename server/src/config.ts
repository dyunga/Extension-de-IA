import { z } from 'zod';
import { decodeCanonicalLocalClientToken } from './lib/local-client-token.js';

export const DEFAULT_AI_TIMEOUT_MS = 45_000;
export const MAX_AI_TIMEOUT_MS = 45_000;
export const MAX_RATE_LIMIT_MAX = 10_000;
export const MAX_RATE_LIMIT_MAX_ENTRIES = 100_000;
export const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  EXTENSION_ORIGINS: z.string().min(1),
  LOCAL_CLIENT_TOKEN: z.string().min(1),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-flash-lite-latest'),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(MAX_AI_TIMEOUT_MS).default(DEFAULT_AI_TIMEOUT_MS),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(MAX_RATE_LIMIT_MAX).default(30),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  RATE_LIMIT_MAX_ENTRIES: z.coerce.number().int().positive().max(MAX_RATE_LIMIT_MAX_ENTRIES).default(10_000),
  TRUST_PROXY: z.preprocess((value) => {
    if (value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }, z.boolean()).default(false)
});

export type AppConfig = ReturnType<typeof loadConfig>;

function parseOrigins(value: string): string[] {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('EXTENSION_ORIGINS must include at least one origin');
  for (const origin of origins) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      throw new Error(`EXTENSION_ORIGINS must contain exact chrome-extension:// origins: ${origin}`);
    }
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const localClientToken = decodeCanonicalLocalClientToken(parsed.LOCAL_CLIENT_TOKEN);
  if (!localClientToken) throw new Error('LOCAL_CLIENT_TOKEN must be the canonical unpadded base64url encoding of exactly 32 bytes');
  return {
    ...parsed,
    EXTENSION_ORIGINS: parseOrigins(parsed.EXTENSION_ORIGINS),
    LOCAL_CLIENT_TOKEN_BYTES: localClientToken,
    RATE_LIMIT_WINDOW_MS: parseRateLimitWindowMs(parsed.RATE_LIMIT_WINDOW)
  };
}

function parseRateLimitWindowMs(value: string): number {
  const match = /^(\d+)\s*(ms|second|seconds|minute|minutes)?$/i.exec(value.trim());
  if (!match) throw new Error('RATE_LIMIT_WINDOW must be a positive duration in ms, seconds, or minutes');
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'ms';
  const multiplier = unit.startsWith('minute') ? 60_000 : unit.startsWith('second') ? 1000 : 1;
  const windowMs = amount * multiplier;
  if (!Number.isSafeInteger(amount) || !Number.isFinite(windowMs) || windowMs <= 0 || windowMs > MAX_RATE_LIMIT_WINDOW_MS) {
    throw new Error(`RATE_LIMIT_WINDOW must be between 1 ms and ${MAX_RATE_LIMIT_WINDOW_MS} ms`);
  }
  return windowMs;
}
