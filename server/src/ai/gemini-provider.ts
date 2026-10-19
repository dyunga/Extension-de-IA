import { GoogleGenAI } from '@google/genai';
import type { AIProvider, AnalyzeImageInput } from './AIProvider.js';
import { studySystemPrompt } from './prompt.js';

interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{ role: 'user'; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>;
      config: {
        systemInstruction: string;
        temperature: number;
        maxOutputTokens: number;
        abortSignal: AbortSignal;
        httpOptions: { retryOptions: { attempts: number } };
      };
    }): Promise<{ text: string | undefined }>;
  };
}

type DelayFn = (ms: number, signal: AbortSignal) => Promise<void>;
type ProviderLogStatus = number | 'ok' | 'aborted' | 'unknown';
type ProviderLogFn = (entry: { provider: 'gemini'; attempt: number; durationMs: number; status: ProviderLogStatus; retrying: boolean }) => void;
export const GEMINI_APPLICATION_MAX_RETRIES = 1;
export const GEMINI_APPLICATION_MAX_ATTEMPTS = GEMINI_APPLICATION_MAX_RETRIES + 1;

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  client?: GeminiClient;
  maxRetries?: 0 | typeof GEMINI_APPLICATION_MAX_RETRIES;
  baseRetryDelayMs?: number;
  delay?: DelayFn;
  logger?: ProviderLogFn;
}

export class GeminiProvider implements AIProvider {
  private readonly client: GeminiClient;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly delay: DelayFn;
  private readonly logger: ProviderLogFn | undefined;

  constructor(options: GeminiProviderOptions) {
    const apiKey = options.apiKey.trim();
    const model = options.model.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for the Gemini provider');
    if (!model) throw new Error('GEMINI_MODEL is required for the Gemini provider');
    if (options.maxRetries !== undefined && options.maxRetries > GEMINI_APPLICATION_MAX_RETRIES) {
      throw new Error(`Gemini application retry policy allows at most ${GEMINI_APPLICATION_MAX_RETRIES} retry (${GEMINI_APPLICATION_MAX_ATTEMPTS} total attempts)`);
    }
    this.client = options.client ?? (new GoogleGenAI({ apiKey }) as GeminiClient);
    this.model = model;
    this.maxRetries = options.maxRetries ?? GEMINI_APPLICATION_MAX_RETRIES;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 150;
    this.delay = options.delay ?? defaultDelay;
    this.logger = options.logger;
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<string> {
    const payload = {
      model: this.model,
      contents: [
        {
          role: 'user' as const,
          parts: [
            { text: 'Return only the final answer according to the policy.' },
            { inlineData: { mimeType: input.mime, data: Buffer.from(input.bytes).toString('base64') } }
          ]
        }
      ],
      config: {
        systemInstruction: studySystemPrompt,
        temperature: 0,
        maxOutputTokens: 200,
        abortSignal: input.signal,
        httpOptions: { retryOptions: { attempts: 1 } }
      }
    };

    const response = await this.generateContentWithRetry(payload, input.signal);

    const text = response.text?.trim();
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }

  private async generateContentWithRetry(
    payload: Parameters<GeminiClient['models']['generateContent']>[0],
    signal: AbortSignal
  ): Promise<{ text: string | undefined }> {
    let retries = 0;
    while (true) {
      throwIfAborted(signal);
      const attempt = retries + 1;
      const startedAt = Date.now();
      try {
        const response = await this.client.models.generateContent(payload);
        this.logAttempt({ attempt, startedAt, status: 'ok', retrying: false });
        return response;
      } catch (error) {
        const retrying = isRetryableGeminiError(error) && retries < this.maxRetries;
        this.logAttempt({ attempt, startedAt, status: geminiLogStatus(error), retrying });
        if (!retrying) throw error;
        retries += 1;
        await this.delay(retryDelayMs(this.baseRetryDelayMs, retries), signal);
      }
    }
  }

  private logAttempt(entry: { attempt: number; startedAt: number; status: ProviderLogStatus; retrying: boolean }): void {
    this.logger?.({ provider: 'gemini', attempt: entry.attempt, durationMs: Date.now() - entry.startedAt, status: entry.status, retrying: entry.retrying });
  }
}

function geminiLogStatus(error: unknown): ProviderLogStatus {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  const status = geminiStatus(error);
  return status === 0 ? 'unknown' : status;
}

function isRetryableGeminiError(error: unknown): boolean {
  const status = geminiStatus(error);
  return status === 429 || (status >= 500 && status <= 599);
}

function geminiStatus(error: unknown): number {
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const value of [candidate?.status, candidate?.statusCode, candidate?.response?.status, candidate?.code]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  if (error instanceof Error) {
    const match = /\b(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*(400|401|403|404|429|5\d\d)\b/i.exec(error.message);
    if (match) return Number(match[1]);
  }
  return 0;
}

function retryDelayMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 25);
}

function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(cleanupAndResolve, ms);
    const abort = () => cleanupAndReject(abortError());
    function cleanupAndResolve() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function cleanupAndReject(error: Error) {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(error);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}
