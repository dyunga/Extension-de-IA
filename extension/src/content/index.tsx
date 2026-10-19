import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HintBar, type HintState } from './HintBar';
import { hintBarCss } from './styles';
import { isHintMessage, type HintMessage } from '../messages';

declare global { interface Window { __visualStudyAssistant?: Runtime } }

interface Runtime {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  root: Root;
  state: HintState;
  currentRequestId: string | undefined;
  dismissedRequestId: string | undefined;
  removeClickListener: (() => void) | undefined;
  apply(message: HintMessage): void;
  dismiss(requestId?: string): void;
}

const hostId = 'visual-study-assistant-root';

function createRuntime(): Runtime {
  const host = document.getElementById(hostId) as HTMLDivElement | null ?? document.createElement('div');
  host.id = hostId;
  if (!host.isConnected) document.documentElement.append(host);
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('style')) {
    const style = document.createElement('style');
    style.textContent = hintBarCss;
    shadow.append(style);
  }
  const mount = document.createElement('div');
  shadow.append(mount);
  const runtime: Runtime = {
    host,
    shadow,
    root: createRoot(mount),
    state: { kind: 'hidden' },
    currentRequestId: undefined,
    dismissedRequestId: undefined,
    removeClickListener: undefined,
    apply(message) { applyMessage(runtime, message); },
    dismiss(requestId) { dismiss(runtime, requestId); }
  };
  render(runtime);
  return runtime;
}

function applyMessage(runtime: Runtime, message: HintMessage): void {
  if (message.type === 'hint/loading') {
    runtime.currentRequestId = message.requestId;
    runtime.dismissedRequestId = undefined;
    runtime.state = { kind: 'loading', requestId: message.requestId };
    armDismiss(runtime);
    render(runtime);
    return;
  }
  if (message.requestId !== runtime.currentRequestId || message.requestId === runtime.dismissedRequestId) return;
  runtime.state = message.type === 'hint/success'
    ? { kind: 'success', requestId: message.requestId, text: message.text }
    : { kind: 'error', requestId: message.requestId, code: message.code, message: message.message };
  armDismiss(runtime);
  render(runtime);
}

function dismiss(runtime: Runtime, requestId = runtime.currentRequestId): void {
  const shouldCancel = runtime.state.kind === 'loading' && runtime.state.requestId === requestId;
  if (requestId) runtime.dismissedRequestId = requestId;
  runtime.state = { kind: 'hidden' };
  runtime.removeClickListener?.();
  runtime.removeClickListener = undefined;
  render(runtime);
  if (shouldCancel) void chrome.runtime.sendMessage({ type: 'request/cancel', requestId });
}

function armDismiss(runtime: Runtime): void {
  runtime.removeClickListener?.();
  const listener = () => {
    if (runtime.state.kind === 'loading') return;
    dismiss(runtime);
  };
  document.addEventListener('click', listener, { capture: true });
  runtime.removeClickListener = () => document.removeEventListener('click', listener, { capture: true });
}

function render(runtime: Runtime): void {
  runtime.root.render(<HintBar state={runtime.state} onDismiss={() => runtime.dismiss()} />);
}

const runtime = window.__visualStudyAssistant ?? createRuntime();
window.__visualStudyAssistant = runtime;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: string })?.type === 'hint/ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (isHintMessage(message)) runtime.apply(message);
  return false;
});
