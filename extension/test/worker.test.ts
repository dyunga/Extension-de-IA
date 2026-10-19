import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChromeMocks } from './setup';

vi.mock('../src/api-client', async () => {
  const actual = await vi.importActual<typeof import('../src/api-client')>('../src/api-client');
  return { ...actual, analyzeImage: vi.fn(async () => '1: A · 2: C'), createTimeoutSignal: vi.fn(actual.createTimeoutSignal) };
});

describe('service worker orchestration', () => {
  beforeEach(() => resetChromeMocks());

  it('rejects restricted and file surfaces before capture or API work', async () => {
    const api = await import('../src/api-client');
    const { handleActivation } = await import('../src/service-worker');
    await handleActivation({ id: 1, url: 'chrome://extensions' } as chrome.tabs.Tab);
    await handleActivation({ id: 2, url: 'file:///tmp/a.html' } as chrome.tabs.Tab);
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(api.analyzeImage).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: 'ERR' });
  });

  it('captures before injecting loading so the hint is not in the screenshot', async () => {
    const api = await import('../src/api-client');
    const { handleActivation } = await import('../src/service-worker');
    const order: string[] = [];
    vi.mocked(chrome.tabs.captureVisibleTab).mockImplementation(async () => { order.push('capture'); return 'data:image/jpeg;base64,/9j/2Q=='; });
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async (_tabId, message) => { order.push((message as { type?: string }).type ?? 'ping'); return undefined; });
    await handleActivation({ id: 3, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    expect(order[0]).toBe('capture');
    expect(order).toContain('hint/loading');
    expect(order.indexOf('hint/loading')).toBeLessThan(order.indexOf('hint/success'));
    expect(api.createTimeoutSignal).toHaveBeenCalledWith(50_000, expect.any(AbortSignal));
  });

  it('recovers by injecting the receiver when ping fails', async () => {
    const { handleActivation } = await import('../src/service-worker');
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error('missing receiver')).mockResolvedValue(undefined);
    await handleActivation({ id: 4, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 4 }, files: ['content.js'] });
  });

  it('keeps stale results from replacing the newest request', async () => {
    const api = await import('../src/api-client');
    const { handleActivation } = await import('../src/service-worker');
    let releaseFirst!: (value: string) => void;
    vi.mocked(api.analyzeImage)
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce('new');
    (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValueOnce('old').mockReturnValueOnce('new');
    const first = handleActivation({ id: 5, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    const second = handleActivation({ id: 5, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(typeof releaseFirst).toBe('function'));
    releaseFirst('old');
    await Promise.all([first, second]);
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, message]) => (message as { text?: string }).text === 'old')).toBe(false);
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, message]) => (message as { text?: string }).text === 'new')).toBe(true);
  });

  it('aborts only the matching active request when content sends cancel', async () => {
    const api = await import('../src/api-client');
    const { handleActivation, handleCancelRequest } = await import('../src/service-worker');
    let activeSignal!: AbortSignal;
    vi.mocked(api.analyzeImage).mockImplementationOnce((_imageDataUrl, signal) => {
      activeSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
      });
    });
    (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValueOnce('cancel-me');

    const activation = handleActivation({ id: 7, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    handleCancelRequest('cancel-me', 7);
    await activation;

    expect(activeSignal.aborted).toBe(true);
    const sentTypes = vi.mocked(chrome.tabs.sendMessage).mock.calls.map(([, message]) => (message as { type?: string }).type);
    expect(sentTypes).toContain('hint/loading');
    expect(sentTypes).not.toContain('hint/success');
    expect(sentTypes).not.toContain('hint/error');
  });

  it('ignores stale cancellation for a previous request id', async () => {
    const api = await import('../src/api-client');
    const { handleActivation, handleCancelRequest } = await import('../src/service-worker');
    let activeSignal!: AbortSignal;
    let release!: (value: string) => void;
    vi.mocked(api.analyzeImage).mockImplementationOnce((_imageDataUrl, signal) => {
      activeSignal = signal;
      return new Promise((resolve) => { release = resolve; });
    });
    (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValueOnce('new-request');

    const activation = handleActivation({ id: 8, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(activeSignal).toBeDefined());
    handleCancelRequest('old-request', 8);
    expect(activeSignal.aborted).toBe(false);
    release('fresh result');
    await activation;

    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, message]) => (message as { text?: string }).text === 'fresh result')).toBe(true);
  });

  it('does not publish a late state after matching cancellation even when provider ignores abort', async () => {
    const api = await import('../src/api-client');
    const { handleActivation, handleCancelRequest } = await import('../src/service-worker');
    let release!: (value: string) => void;
    vi.mocked(api.analyzeImage).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValueOnce('ignored-abort');

    const activation = handleActivation({ id: 9, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    handleCancelRequest('ignored-abort', 9);
    release('late result');
    await activation;

    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, message]) => (message as { text?: string }).text === 'late result')).toBe(false);
  });

  it('propagates cancellation that happens before transport signal creation', async () => {
    const api = await import('../src/api-client');
    const { handleActivation, handleCancelRequest } = await import('../src/service-worker');
    (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValueOnce('pre-aborted');
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async (tabId, message) => {
      if ((message as { type?: string }).type === 'hint/loading') handleCancelRequest('pre-aborted', tabId as number);
      return undefined;
    });
    vi.mocked(api.analyzeImage).mockImplementationOnce(async (_imageDataUrl, signal) => {
      expect(signal.aborted).toBe(true);
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await handleActivation({ id: 10, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);

    expect(api.createTimeoutSignal).toHaveBeenCalledWith(50_000, expect.any(AbortSignal));
    expect(api.analyzeImage).toHaveBeenCalledOnce();
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.some(([, message]) => ['hint/success', 'hint/error'].includes((message as { type?: string }).type ?? ''))).toBe(false);
  });

  it('maps API errors to sanitized hint errors', async () => {
    const api = await import('../src/api-client');
    const { handleActivation } = await import('../src/service-worker');
    vi.mocked(api.analyzeImage).mockRejectedValueOnce(new api.ApiError('SERVICE_UNAVAILABLE', 'No disponible'));
    await handleActivation({ id: 6, windowId: 7, url: 'https://example.com' } as chrome.tabs.Tab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(6, expect.objectContaining({ type: 'hint/error', code: 'SERVICE_UNAVAILABLE', message: 'No disponible' }));
  });
});
