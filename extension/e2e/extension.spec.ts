import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extensionDist = path.resolve('dist');
const fixtureOrigin = 'http://127.0.0.1:8787';
const fixtureUrl = `${fixtureOrigin}/study-fixture`;

async function startFixtureServer(): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url !== '/study-fixture') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Visual Study Assistant fixture</title>
          <style>* { color: rgb(10, 10, 10); }</style>
        </head>
        <body>
          <main>
            <h1>Deterministic study fixture</h1>
            <p>Question 1: Which option is correct?</p>
            <ol><li>A</li><li>B</li><li>C</li></ol>
          </main>
        </body>
      </html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(8787, '127.0.0.1', resolve);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function isUnpackedExtensionLaunchUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return process.platform !== 'win32' && /headed browser without having a XServer|extensions are not supported in headless/i.test(message);
}

async function shadowText(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launchPersistentContext>>['newPage']>>): Promise<string> {
  return page.evaluate(() => document.querySelector('#visual-study-assistant-root')?.shadowRoot?.textContent ?? '');
}

async function renderedHintText(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launchPersistentContext>>['newPage']>>): Promise<string> {
  return page.evaluate(() => document.querySelector('#visual-study-assistant-root')?.shadowRoot?.querySelector('.vsa-hint')?.textContent ?? '');
}

async function hintAriaLabel(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launchPersistentContext>>['newPage']>>): Promise<string | null> {
  return page.evaluate(() => document.querySelector('#visual-study-assistant-root')?.shadowRoot?.querySelector('.vsa-hint')?.getAttribute('aria-label') ?? null);
}

async function hintStyleEvidence(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launchPersistentContext>>['newPage']>>) {
  return page.evaluate(() => {
    function alphaFrom(color: string): number {
      const rgba = /rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/.exec(color);
      return rgba?.[1] === undefined ? 1 : Number(rgba[1]);
    }
    const root = document.querySelector('#visual-study-assistant-root')?.shadowRoot;
    const hint = root?.querySelector<HTMLElement>('.vsa-hint');
    const text = root?.querySelector<HTMLElement>('.vsa-hint__text');
    if (!hint || !text) throw new Error('Hint and text nodes must be visible for style evidence');
    const hintStyle = getComputedStyle(hint);
    const textStyle = getComputedStyle(text);
    const hintAlpha = alphaFrom(hintStyle.backgroundColor);
    const textAlpha = alphaFrom(textStyle.backgroundColor);
    return {
      hintBackgroundColor: hintStyle.backgroundColor,
      textBackgroundColor: textStyle.backgroundColor,
      hintAlpha,
      textAlpha,
      backdropFilter: hintStyle.backdropFilter || hintStyle.getPropertyValue('-webkit-backdrop-filter')
    };
  });
}

test('loads the MV3 extension and injects the hint receiver on an allowed local page', async () => {
  expect(existsSync(path.join(extensionDist, 'manifest.json'))).toBe(true);
  expect(existsSync(path.join(extensionDist, 'service-worker.js'))).toBe(true);
  expect(existsSync(path.join(extensionDist, 'content.js'))).toBe(true);

  const manifest = JSON.parse(await readFile(path.join(extensionDist, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({
    manifest_version: 3,
    action: { default_title: 'Analyze visible study content' },
    background: { service_worker: 'service-worker.js', type: 'module' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+A' },
        description: 'Analyze visible study content'
      }
    },
    permissions: expect.arrayContaining(['activeTab', 'scripting']),
    host_permissions: [`${fixtureOrigin}/*`]
  });

  const fixtureServer = await startFixtureServer();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'vsa-extension-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`]
      });
    } catch (error) {
      if (isUnpackedExtensionLaunchUnavailable(error)) {
        test.skip(true, `Chromium cannot launch a headed unpacked-extension context in this environment: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(worker.url()).host;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(worker.url()).toBe(`chrome-extension://${extensionId}/service-worker.js`);

    const registrationScope = await worker.evaluate(() => (self as unknown as { registration: { scope: string } }).registration.scope);
    expect(registrationScope).toBe(`chrome-extension://${extensionId}/`);

    const runtimeId = await worker.evaluate(() => chrome.runtime.id);
    expect(runtimeId).toBe(extensionId);

    const workerManifest = await worker.evaluate(() => chrome.runtime.getManifest());
    expect(workerManifest).toMatchObject({
      manifest_version: 3,
      background: { service_worker: 'service-worker.js', type: 'module' },
      permissions: expect.arrayContaining(['activeTab', 'scripting']),
      host_permissions: [`${fixtureOrigin}/*`],
      commands: {
        _execute_action: {
          suggested_key: { default: 'Alt+A' },
          description: 'Analyze visible study content'
        }
      }
    });

    const page = await context.newPage();
    await page.goto(fixtureUrl);
    await expect(page.getByRole('heading', { name: 'Deterministic study fixture' })).toBeVisible();

    const tabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Active tab id was unavailable');
      return tab.id;
    });

    await worker.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    }, tabId);

    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('#visual-study-assistant-root')?.shadowRoot))).toBe(true);

    await worker.evaluate(async ({ id, message }) => {
      await chrome.tabs.sendMessage(id, message);
    }, { id: tabId, message: { type: 'hint/loading', requestId: 'e2e-request' } });

    const loadingStatus = page.getByRole('status', { name: 'Analyzing capture' });
    await expect(loadingStatus).toHaveText('✨×');
    await expect.poll(() => shadowText(page)).not.toContain('Analizando captura…');
    await expect.poll(() => hintAriaLabel(page)).toBe('Analyzing capture');
    await page.getByRole('heading', { name: 'Deterministic study fixture' }).click();
    await expect.poll(() => renderedHintText(page)).toBe('✨×');

    await worker.evaluate(async ({ id, message }) => {
      await chrome.tabs.sendMessage(id, message);
    }, { id: tabId, message: { type: 'hint/success', requestId: 'e2e-request', text: '1: C' } });

    await expect.poll(() => shadowText(page)).toContain('1: C');
    const styleEvidence = await hintStyleEvidence(page);
    expect(styleEvidence.hintAlpha).toBeLessThan(0.5);
    expect(styleEvidence.textAlpha).toBeGreaterThan(styleEvidence.hintAlpha);
    expect(styleEvidence.textAlpha).toBeGreaterThanOrEqual(0.75);
    expect(styleEvidence.backdropFilter).toContain('blur');
    await page.getByRole('heading', { name: 'Deterministic study fixture' }).click();
    await expect.poll(() => shadowText(page)).not.toContain('1: C');
  } finally {
    if (context) await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await closeServer(fixtureServer);
  }
});
