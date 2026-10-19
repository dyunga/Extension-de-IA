import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeImage, createTimeoutSignal, EXTENSION_TRANSPORT_TIMEOUT_MS } from '../src/api-client';

describe('extension API client', () => {
  const localClientToken = 'paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaU';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('consumes the public success contract from { message }', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: '1: A · 2: C' }), { status: 200 }));

    await expect(analyzeImage('data:image/jpeg;base64,/9j/2Q==', new AbortController().signal, 'http://127.0.0.1:8787', localClientToken))
      .resolves.toBe('1: A · 2: C');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8787/api/analyze', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'X-Local-Client-Token': localClientToken }
    }));
  });

  it('rejects stale { result } success bodies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ result: 'stale contract' }), { status: 200 }));

    await expect(analyzeImage('data:image/jpeg;base64,/9j/2Q==', new AbortController().signal, 'http://127.0.0.1:8787', localClientToken))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'La respuesta del servicio no es válida.' });
  });

  it('uses the fixed extension transport deadline', () => {
    expect(EXTENSION_TRANSPORT_TIMEOUT_MS).toBe(50_000);
  });

  it('creates an aborting transport deadline without waiting for the production timeout', () => {
    vi.useFakeTimers();
    try {
      const signal = createTimeoutSignal(25);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(25);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('immediately mirrors an already-aborted upstream signal', () => {
    vi.useFakeTimers();
    try {
      const upstream = new AbortController();
      upstream.abort();

      const signal = createTimeoutSignal(25, upstream.signal);

      expect(signal.aborted).toBe(true);
      vi.advanceTimersByTime(25);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes an already-aborted signal to fetch so no transport can continue', async () => {
    const upstream = new AbortController();
    upstream.abort();
    const signal = createTimeoutSignal(50_000, upstream.signal);
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      expect((init as RequestInit).signal).toBe(signal);
      expect(signal.aborted).toBe(true);
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(analyzeImage('data:image/jpeg;base64,/9j/2Q==', signal, 'http://127.0.0.1:8787', localClientToken))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
