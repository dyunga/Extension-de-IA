import { describe, expect, it, vi } from 'vitest';
import { GEMINI_APPLICATION_MAX_ATTEMPTS, GEMINI_APPLICATION_MAX_RETRIES, GeminiProvider } from '../src/ai/gemini-provider.js';
import { studySystemPrompt } from '../src/ai/prompt.js';
import { prepareStudyResponse } from '../src/lib/response-policy.js';
import { jpegDataUrl } from './fixtures.js';

type GenerateContentPayload = {
  model: string;
  contents: Array<{ role: 'user'; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>;
  config: { systemInstruction: string; temperature: number; maxOutputTokens: number; abortSignal: AbortSignal; httpOptions: { retryOptions: { attempts: number } } };
};

function geminiClient(text = '1: A · 2: C') {
  const generateContent = vi.fn(async (_params: GenerateContentPayload): Promise<{ text: string | undefined }> => ({ text }));
  return { models: { generateContent } };
}

function geminiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`Gemini upstream ${status}`), { status });
}

function providerInput() {
  return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg' as const, signal: new AbortController().signal };
}

describe('GeminiProvider', () => {
  it('sends model, prompt, MIME/base64 image payload, and abort signal', async () => {
    const controller = new AbortController();
    const client = geminiClient();
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-flash-lite-latest', client });
    const dataUrl = jpegDataUrl(8);
    const base64 = dataUrl.split(',')[1] ?? '';
    const bytes = Buffer.from(base64, 'base64');

    const result = await provider.analyzeImage({ bytes: new Uint8Array(bytes), mime: 'image/jpeg', signal: controller.signal });

    expect(result).toBe('1: A · 2: C');
    expect(client.models.generateContent).toHaveBeenCalledOnce();
    const payload = client.models.generateContent.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      model: 'gemini-flash-lite-latest',
      config: {
        systemInstruction: studySystemPrompt,
        temperature: 0,
        maxOutputTokens: 200,
        abortSignal: controller.signal,
        httpOptions: { retryOptions: { attempts: 1 } }
      }
    });
    expect(payload?.contents[0]?.parts).toContainEqual({ text: 'Return only the final answer according to the policy.' });
    expect(payload?.contents[0]?.parts).toContainEqual({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
  });

  it('disables nested SDK retries while preserving application-level retry calls', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(geminiError(503))
      .mockResolvedValueOnce({ text: 'C' });
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-flash-lite-latest',
      client: { models: { generateContent } },
      delay: async () => undefined
    });

    await expect(provider.analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal })).resolves.toBe('C');

    expect(generateContent).toHaveBeenCalledTimes(2);
    for (const [payload] of generateContent.mock.calls) {
      expect(payload.config.httpOptions.retryOptions.attempts).toBe(1);
    }
  });

  it('trims response text and rejects empty model responses', async () => {
    await expect(new GeminiProvider({ apiKey: 'test-key', model: 'gemini-flash-lite-latest', client: geminiClient('  C  ') })
      .analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal }))
      .resolves.toBe('C');
    await expect(new GeminiProvider({ apiKey: 'test-key', model: 'gemini-flash-lite-latest', client: geminiClient('   ') })
      .analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal }))
      .rejects.toThrow('empty response');
  });

  it('validates missing or empty server-only Gemini configuration', () => {
    expect(() => new GeminiProvider({ apiKey: '', model: 'gemini-flash-lite-latest', client: geminiClient() })).toThrow('GEMINI_API_KEY');
    expect(() => new GeminiProvider({ apiKey: 'test-key', model: ' ', client: geminiClient() })).toThrow('GEMINI_MODEL');
  });

  it('retries transient Gemini 429 and 5xx failures before succeeding', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(geminiError(429))
      .mockResolvedValueOnce({ text: 'C' });
    const delays: number[] = [];
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-flash-lite-latest',
      client: { models: { generateContent } },
      baseRetryDelayMs: 100,
      delay: async (ms) => { delays.push(ms); }
    });

    await expect(provider.analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal })).resolves.toBe('C');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it('recognizes structured SDK status fields as retryable transient failures', async () => {
    for (const error of [
      { status: 503 },
      { statusCode: 502 },
      { response: { status: 500 } },
      { code: 429 },
      new Error('Gemini request failed with HTTP 503'),
      new Error('Gemini request failed with status: 429'),
      new Error('Gemini request failed with status code 500')
    ]) {
      const generateContent = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ text: 'C' });
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-flash-lite-latest',
        client: { models: { generateContent } },
        delay: async () => undefined
      });

      await expect(provider.analyzeImage(providerInput())).resolves.toBe('C');
      expect(generateContent).toHaveBeenCalledTimes(2);
    }
  });

  it('does not retry incidental numbers in generic error messages', async () => {
    for (const message of ['request took 500ms', 'batch id 429 failed', 'model emitted 503 tokens before failing']) {
      const generateContent = vi.fn().mockRejectedValue(new Error(message));
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-flash-lite-latest',
        client: { models: { generateContent } },
        delay: async () => { throw new Error('delay should not run'); }
      });

      await expect(provider.analyzeImage(providerInput())).rejects.toThrow(message);
      expect(generateContent).toHaveBeenCalledOnce();
    }
  });

  it('exhausts bounded retries for persistent transient failures', async () => {
    const generateContent = vi.fn().mockRejectedValue(geminiError(500));
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-flash-lite-latest',
      client: { models: { generateContent } },
      delay: async () => undefined
    });

    await expect(provider.analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal })).rejects.toMatchObject({ status: 500 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(GEMINI_APPLICATION_MAX_RETRIES).toBe(1);
    expect(GEMINI_APPLICATION_MAX_ATTEMPTS).toBe(2);
  });

  it('rejects retry policy configuration above two total application attempts', () => {
    expect(() => new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-flash-lite-latest',
      client: geminiClient(),
      maxRetries: 2 as 0 | 1
    })).toThrow('at most 1 retry (2 total attempts)');
  });

  it('logs safe provider attempt metadata without payloads, output, API key, or prompt', async () => {
    const apiKey = 'AIza-provider-secret';
    const base64 = jpegDataUrl(8).split(',')[1] ?? '';
    const logs: unknown[] = [];
    const generateContent = vi.fn()
      .mockRejectedValueOnce(geminiError(503))
      .mockResolvedValueOnce({ text: 'modelo secreto' });
    const provider = new GeminiProvider({
      apiKey,
      model: 'gemini-flash-lite-latest',
      client: { models: { generateContent } },
      delay: async () => undefined,
      logger: (entry) => logs.push(entry)
    });

    await expect(provider.analyzeImage({ bytes: Buffer.from(base64, 'base64'), mime: 'image/jpeg', signal: new AbortController().signal })).resolves.toBe('modelo secreto');

    expect(logs).toEqual([
      expect.objectContaining({ provider: 'gemini', attempt: 1, status: 503, retrying: true }),
      expect.objectContaining({ provider: 'gemini', attempt: 2, status: 'ok', retrying: false })
    ]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(base64);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain('modelo secreto');
    expect(serialized).not.toContain(studySystemPrompt);
  });

  it('does not retry 404 or auth/provider configuration failures', async () => {
    for (const status of [400, 401, 403, 404]) {
      const generateContent = vi.fn().mockRejectedValue(geminiError(status));
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-flash-lite-latest',
        client: { models: { generateContent } },
        delay: async () => { throw new Error('delay should not run'); }
      });
      await expect(provider.analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: new AbortController().signal })).rejects.toMatchObject({ status });
      expect(generateContent).toHaveBeenCalledOnce();
    }
  });

  it('aborts during retry backoff without scheduling a later provider call', async () => {
    const controller = new AbortController();
    const generateContent = vi.fn().mockRejectedValue(geminiError(503));
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-flash-lite-latest',
      client: { models: { generateContent } },
      delay: async (_ms, signal) => {
        controller.abort();
        if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      }
    });

    await expect(provider.analyzeImage({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generateContent).toHaveBeenCalledOnce();
  });
});

describe('AI response policy and prompt', () => {
  it('preserves compact questionnaire answers without reasoning', () => {
    expect(prepareStudyResponse('1: A · 2: C · 3: B')).toBe('1: A · 2: C · 3: B');
    expect(prepareStudyResponse('C')).toBe('C');
    expect(studySystemPrompt).toContain('Prioritize the questionnaire block closest to the center of the viewport');
    expect(studySystemPrompt).toContain('Carefully read all visible centered questionnaire questions and their visible options');
    expect(studySystemPrompt).toContain('For one visible questionnaire question, return only the option letter');
    expect(studySystemPrompt).toContain('do not invent an answer');
    expect(studySystemPrompt).toContain('genuinely useful concise study help');
    expect(studySystemPrompt).toContain('Do not explain reasoning');
    expect(studySystemPrompt).toContain('Never include chain-of-thought or hidden reasoning');
  });

  it('caps fallback Spanish study help to sixty words', () => {
    const long = Array.from({ length: 75 }, (_, index) => `palabra${index}`).join(' ');
    expect(prepareStudyResponse(long).split(/\s+/)).toHaveLength(60);
  });
});
