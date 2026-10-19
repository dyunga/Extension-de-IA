import { analyzeImage, ApiError, createTimeoutSignal, EXTENSION_TRANSPORT_TIMEOUT_MS } from './api-client';
import type { ControlMessage, HintErrorCode, HintMessage } from './messages';

interface InFlight { requestId: string; controller: AbortController }

const inFlightByTab = new Map<number, InFlight>();

chrome.action.onClicked.addListener((tab) => {
  void handleActivation(tab);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isCancelMessage(message)) return false;
  handleCancelRequest(message.requestId, sender.tab?.id);
  return false;
});

export async function handleActivation(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  if (!tabId || !isSupportedUrl(tab.url)) {
    await showBadge(tabId, 'ERR');
    return;
  }

  const requestId = crypto.randomUUID();
  const previous = inFlightByTab.get(tabId);
  previous?.controller.abort();
  const controller = new AbortController();
  inFlightByTab.set(tabId, { requestId, controller });

  try {
    const imageDataUrl = await capture(tab.windowId);
    await ensureReceiver(tabId);
    await sendHint(tabId, { type: 'hint/loading', requestId });
    const text = await analyzeImage(imageDataUrl, createTimeoutSignal(EXTENSION_TRANSPORT_TIMEOUT_MS, controller.signal));
    if (isCurrent(tabId, requestId)) await sendHint(tabId, { type: 'hint/success', requestId, text });
  } catch (error) {
    if (controller.signal.aborted) return;
    const { code, message } = toHintError(error);
    if (isCurrent(tabId, requestId)) {
      try { await sendHint(tabId, { type: 'hint/error', requestId, code, message }); }
      catch { await showBadge(tabId, 'ERR'); }
    }
  } finally {
    if (isCurrent(tabId, requestId)) inFlightByTab.delete(tabId);
  }
}

export function handleCancelRequest(requestId: string, tabId: number | undefined): void {
  if (!tabId) return;
  const active = inFlightByTab.get(tabId);
  if (active?.requestId !== requestId) return;
  active.controller.abort();
  inFlightByTab.delete(tabId);
}

export function isSupportedUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (/chrome\.google\.com|chromewebstore\.google\.com|microsoftedge\.microsoft\.com/.test(parsed.hostname)) return false;
    return true;
  } catch { return false; }
}

function capture(windowId?: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'jpeg', quality: 80 });
}

async function ensureReceiver(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'hint/ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

function sendHint(tabId: number, message: HintMessage): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message);
}

function isCurrent(tabId: number, requestId: string): boolean {
  return inFlightByTab.get(tabId)?.requestId === requestId;
}

function isCancelMessage(value: unknown): value is ControlMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ControlMessage>;
  return message.type === 'request/cancel' && typeof message.requestId === 'string' && message.requestId.length > 0;
}

function toHintError(error: unknown): { code: HintErrorCode; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error && error.name === 'AbortError') return { code: 'TIMEOUT', message: 'El análisis tardó demasiado.' };
  return { code: 'CAPTURE_FAILED', message: 'No se pudo analizar esta página.' };
}

async function showBadge(tabId: number | undefined, text: string): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#B42318' });
  setTimeout(() => { void chrome.action.setBadgeText({ tabId, text: '' }); }, 3000);
}
