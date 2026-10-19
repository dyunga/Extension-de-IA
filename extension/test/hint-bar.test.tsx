import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

async function loadContent() {
  vi.resetModules();
  await act(async () => { await import('../src/content/index'); });
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('listener missing');
  return async (message: unknown) => {
    await act(async () => { listener(message, {} as chrome.runtime.MessageSender, vi.fn()); });
  };
}

function shadowRoot(): ShadowRoot {
  const root = document.querySelector('#visual-study-assistant-root')?.shadowRoot;
  if (!root) throw new Error('shadow root missing');
  return root;
}

function hintText(): string {
  return shadowRoot().querySelector('.vsa-hint')?.textContent ?? '';
}

function hintElement(): HTMLElement {
  const hint = shadowRoot().querySelector<HTMLElement>('.vsa-hint');
  if (!hint) throw new Error('hint missing');
  return hint;
}

type Rgb = [number, number, number];

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha)
  ];
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function glassContrastOverWhite(base: Rgb, baseAlpha: number, highlight: Rgb, highlightAlpha: number): number {
  const page = [255, 255, 255] as Rgb;
  const baseComposite = composite(base, page, baseAlpha);
  const finalComposite = composite(highlight, baseComposite, highlightAlpha);
  return contrastRatio(page, finalComposite);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backgroundLayers(style: string, selector: string, branch: 'fallback' | 'filtered') {
  const supportsIndex = style.indexOf('@supports');
  const branchStyle = branch === 'fallback' ? style.slice(0, supportsIndex) : style.slice(supportsIndex);
  const rule = new RegExp(`${escapeRegex(selector)}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(branchStyle)?.[1];
  if (!rule) throw new Error(`${branch} ${selector} rule missing`);
  const background = /background:\s*([\s\S]*?);/.exec(rule)?.[1];
  if (!background) throw new Error(`${branch} ${selector} background missing`);
  const rgbaMatches = [...background.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0?\.\d+)\)/g)].map((match) => ({
    color: [Number(match[1]), Number(match[2]), Number(match[3])] as Rgb,
    alpha: Number(match[4])
  }));
  if (rgbaMatches.length !== 3) throw new Error(`${branch} ${selector} expected two gradient stops and one base layer`);
  const [firstHighlight, secondHighlight, base] = rgbaMatches;
  if (!firstHighlight || !secondHighlight || !base) throw new Error(`${branch} ${selector} background layer parse failed`);
  return { highlights: [firstHighlight, secondHighlight], base };
}

function worstGlassContrastOverWhite(style: string, selector: string, branch: 'fallback' | 'filtered'): number {
  const { highlights, base } = backgroundLayers(style, selector, branch);
  return Math.min(...highlights.map((highlight) => glassContrastOverWhite(base.color, base.alpha, highlight.color, highlight.alpha)));
}

function backingContrastOverWhite(style: string, selector: string): number {
  const rule = new RegExp(`${escapeRegex(selector)}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(style)?.[1];
  if (!rule) throw new Error(`${selector} rule missing`);
  const match = /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0?\.\d+)\)/.exec(rule);
  if (!match) throw new Error(`${selector} background parse failed`);
  const page = [255, 255, 255] as Rgb;
  const backing = composite([Number(match[1]), Number(match[2]), Number(match[3])] as Rgb, page, Number(match[4]));
  return contrastRatio(page, backing);
}

describe('Shadow DOM hint bar', () => {
  beforeEach(() => { document.documentElement.innerHTML = '<head></head><body><main>Page</main></body>'; delete window.__visualStudyAssistant; });
  afterEach(() => vi.restoreAllMocks());

  it('creates one reusable Shadow DOM host and renders text states', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    const host = document.querySelector('#visual-study-assistant-root');
    await send({ type: 'hint/success', requestId: 'a', text: '1: A · 2: C' });
    await send({ type: 'hint/loading', requestId: 'b' });
    expect(document.querySelectorAll('#visual-study-assistant-root')).toHaveLength(1);
    expect(document.querySelector('#visual-study-assistant-root')).toBe(host);
    const text = hintText();
    expect(text).toBe('✨×');
    expect(hintElement().getAttribute('aria-label')).toBe('Analyzing capture');
    expect(shadowRoot().querySelector('.vsa-hint__text')).toBeNull();
    expect(shadowRoot().querySelectorAll('.vsa-hint')).toHaveLength(1);
  });

  it('keeps host-page CSS isolated and preserves the long-text wrapping style contract', async () => {
    document.head.innerHTML = '<style>*{position:static!important;white-space:nowrap!important;color:red!important}</style>';
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    await send({ type: 'hint/success', requestId: 'a', text: Array.from({ length: 60 }, (_, index) => `palabra${index}`).join(' ') });
    const style = shadowRoot().querySelector('style')?.textContent ?? '';
    expect(style).toContain(':host {');
    expect(style).toContain('all: initial');
    expect(style).toContain('position: fixed');
    expect(style).toContain('width: fit-content');
    expect(style).toContain('min-width: 180px');
    expect(style).toContain('.vsa-hint--loading');
    expect(style).toContain('min-width: 0');
    expect(style).toContain('max-width: min(680px, calc(100vw - 32px))');
    expect(style).toContain('overflow-wrap: anywhere');
    expect(style).toContain('@media (prefers-reduced-motion: reduce)');
    expect(shadowRoot().textContent).toContain('palabra59');
  });

  it('connects rendered success/error classes to the glass style contract', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    await send({ type: 'hint/success', requestId: 'a', text: 'Readable answer' });
    const successHint = hintElement();
    const style = shadowRoot().querySelector('style')?.textContent ?? '';
    expect([...successHint.classList]).toEqual(expect.arrayContaining(['vsa-hint', 'vsa-hint--success']));
    expect(style).toContain('linear-gradient(135deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.08))');
    expect(style).toContain('rgba(17, 24, 39, 0.38)');
    expect(style).toContain('.vsa-hint__text');
    expect(style).toContain('background: rgba(17, 24, 39, 0.78)');
    expect(style).toContain('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72)');
    expect(style).toContain('@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(style).toContain('linear-gradient(135deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.04))');
    expect(style).toContain('rgba(17, 24, 39, 0.34)');
    expect(style).toContain('-webkit-backdrop-filter: blur(24px) saturate(1.45)');
    expect(style).toContain('backdrop-filter: blur(24px) saturate(1.45)');
    const normalFallbackContrast = worstGlassContrastOverWhite(style, '.vsa-hint', 'fallback');
    const normalFilteredContrast = worstGlassContrastOverWhite(style, '.vsa-hint', 'filtered');
    expect(normalFallbackContrast).toBeLessThan(2);
    expect(normalFilteredContrast).toBeLessThan(2);
    expect(backingContrastOverWhite(style, '.vsa-hint__text')).toBeGreaterThanOrEqual(4.5);

    await send({ type: 'hint/loading', requestId: 'error' });
    await send({ type: 'hint/error', requestId: 'error', code: 'SERVICE_UNAVAILABLE', message: 'No disponible' });
    const errorHint = hintElement();
    expect([...errorHint.classList]).toEqual(expect.arrayContaining(['vsa-hint', 'vsa-hint--error']));
    expect(style).toContain('.vsa-hint--error');
    expect(style).toContain('border-color: rgba(254, 202, 202, 0.44)');
    expect(style).toContain('linear-gradient(135deg, rgba(254, 226, 226, 0.14), rgba(254, 226, 226, 0.05))');
    expect(style).toContain('rgba(127, 29, 29, 0.46)');
    expect(style).toContain('.vsa-hint--error .vsa-hint__text');
    expect(style).toContain('background: rgba(127, 29, 29, 0.84)');
    const errorFallbackContrast = worstGlassContrastOverWhite(style, '.vsa-hint--error', 'fallback');
    const errorFilteredContrast = worstGlassContrastOverWhite(style, '.vsa-hint--error', 'filtered');
    expect(errorFallbackContrast).toBeLessThan(3);
    expect(errorFilteredContrast).toBeLessThan(3);
    expect(backingContrastOverWhite(style, '.vsa-hint--error .vsa-hint__text')).toBeGreaterThanOrEqual(4.5);
  });

  it('transitions loading to success and sanitized error without remounting the host', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'success' });
    const host = document.querySelector('#visual-study-assistant-root');
    expect(shadowRoot().textContent).not.toContain('Analizando captura…');
    expect(hintText()).toBe('✨×');
    expect(hintElement().getAttribute('aria-label')).toBe('Analyzing capture');
    await send({ type: 'hint/success', requestId: 'success', text: 'C' });
    expect(document.querySelector('#visual-study-assistant-root')).toBe(host);
    expect(shadowRoot().textContent).toContain('C');
    expect(hintElement().hasAttribute('aria-label')).toBe(false);
    await send({ type: 'hint/loading', requestId: 'error' });
    await send({ type: 'hint/error', requestId: 'error', code: 'SERVICE_UNAVAILABLE', message: 'No disponible' });
    expect(document.querySelector('#visual-study-assistant-root')).toBe(host);
    expect(shadowRoot().textContent).toContain('No disponible');
  });

  it('ignores stale updates older than the newest loading request', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'old' });
    await send({ type: 'hint/loading', requestId: 'new' });
    await send({ type: 'hint/success', requestId: 'old', text: 'old result' });
    const text = shadowRoot().textContent ?? '';
    expect(text).not.toContain('old result');
  });

  it('ignores page clicks while loading but lets × cancel the active request', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    await act(async () => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await send({ type: 'hint/success', requestId: 'a', text: 'late' });
    let text = hintText();
    expect(text).toContain('late');
    await send({ type: 'hint/loading', requestId: 'b' });
    const button = shadowRoot().querySelector('button');
    expect(button?.textContent).toBe('×');
    await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await send({ type: 'hint/error', requestId: 'b', code: 'SERVICE_UNAVAILABLE', message: 'late error' });
    text = hintText();
    expect(text).toBe('');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'request/cancel', requestId: 'b' });
  });

  it('does not let a page click while loading suppress a later error', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'error-after-click' });
    await act(async () => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await send({ type: 'hint/error', requestId: 'error-after-click', code: 'SERVICE_UNAVAILABLE', message: 'No disponible' });
    expect(hintText()).toContain('No disponible');
  });

  it('dismisses success and error results on arbitrary page click', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'success' });
    await send({ type: 'hint/success', requestId: 'success', text: 'answer' });
    await act(async () => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(hintText()).toBe('');

    await send({ type: 'hint/loading', requestId: 'error' });
    await send({ type: 'hint/error', requestId: 'error', code: 'SERVICE_UNAVAILABLE', message: 'No disponible' });
    await act(async () => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(hintText()).toBe('');
  });

  it('keeps exactly one active page listener across reactivation and removes it on dismissal', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    await send({ type: 'hint/success', requestId: 'a', text: 'A' });
    await send({ type: 'hint/loading', requestId: 'b' });
    await send({ type: 'hint/success', requestId: 'b', text: 'B' });
    const addedClicksBeforeDismiss = add.mock.calls.filter(([type]) => type === 'click').length;
    const removedClicksAfterSuccess = remove.mock.calls.filter(([type]) => type === 'click').length;
    expect(addedClicksBeforeDismiss - removedClicksAfterSuccess).toBe(1);
    await act(async () => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const removedClicksAfterDismiss = remove.mock.calls.filter(([type]) => type === 'click').length;
    expect(addedClicksBeforeDismiss - removedClicksAfterDismiss).toBe(0);
  });

  it('does not treat activation messages as page clicks', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    expect(shadowRoot().textContent).not.toContain('Analizando captura…');
    expect(hintText()).toBe('✨×');
  });

  it('does not use time-based dismissal', async () => {
    const send = await loadContent();
    await send({ type: 'hint/loading', requestId: 'a' });
    await send({ type: 'hint/success', requestId: 'a', text: 'Respuesta corta' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = shadowRoot().textContent ?? '';
    expect(text).toContain('Respuesta corta');
  });
});
