import { vi } from 'vitest';

const listeners: Array<(tab: chrome.tabs.Tab) => void> = [];

Object.defineProperty(globalThis, 'chrome', {
  value: {
    action: {
      onClicked: { addListener: vi.fn((listener) => listeners.push(listener)) },
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined)
    },
    tabs: {
      captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,/9j/2Q=='),
      sendMessage: vi.fn(async () => undefined)
    },
    windows: { WINDOW_ID_CURRENT: -2 },
    scripting: { executeScript: vi.fn(async () => undefined) },
    runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn(async () => undefined) }
  },
  configurable: true
});

Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: vi.fn(() => 'request-id') },
  configurable: true
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function resetChromeMocks() {
  vi.clearAllMocks();
  (globalThis.crypto.randomUUID as ReturnType<typeof vi.fn>).mockReturnValue('request-id');
}
