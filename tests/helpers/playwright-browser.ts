import assert from 'node:assert/strict';
import { test as base, chromium, type Browser, type BrowserContext, type CDPSession, type TestInfo } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildBrowserScript } from './browser-build.js';
import { buildPanelStyles } from './panel-styles.js';
import { waitForDevToolsPort } from './browser-startup.js';
import { chrome } from './browser.js';

type ManagedBrowser = { browser: Browser; child: ChildProcess; chromePid: number; workerIndex: number };
function record(value: Record<string, unknown>) {
  const line = JSON.stringify({ observedAt: new Date().toISOString(), workerPid: process.pid, ...value });
  console.log(`browser-timings ${line}`);
  const target = process.env.CLAPGRID_BROWSER_TIMINGS;
  if (target) { mkdirSync(dirname(target), { recursive: true }); appendFileSync(target, line + '\n'); }
}
async function bounded<T>(operation: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(message)), timeout); })]); }
  finally { clearTimeout(timer!); }
}
async function removeDirectory(directory: string) {
  const { removeOwnedSubdirectory } = await import(new URL('../../scripts/playwright-resources.mjs', import.meta.url).href);
  removeOwnedSubdirectory(directory, process.env.CLAPGRID_PLAYWRIGHT_RESOURCE_ROOT, process.env.CLAPGRID_TEST_EXECUTION_ID);
}
async function managedBrowser(use: (browser: ManagedBrowser) => Promise<void>, workerIndex: number) {
  if (!chrome) throw Error('UI 需要真实 Chrome；浏览器缺失不能跳过');
  const started = performance.now();
  const resourceRoot = process.env.CLAPGRID_PLAYWRIGHT_RESOURCE_ROOT;
  if (!resourceRoot) throw Error('浏览器必须通过受控 Playwright 入口运行');
  const directory = mkdtempSync(join(resourceRoot, 'worker-'));
  const child = spawn(chrome, ['--headless', '--window-size=1600,1000', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { stdio: 'ignore', detached: false });
  let exited = false, browser: Browser | undefined;
  const closed = new Promise<void>((resolve, reject) => { child.once('exit', () => { exited = true; resolve(); }); child.once('error', error => { exited = true; reject(error); }); });
  try {
    const port = await Promise.race([waitForDevToolsPort(join(directory, 'DevToolsActivePort')), closed.then(() => { throw Error('Chrome 在调试端口就绪前退出'); })]);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
    record({ event: 'worker-start', workerIndex, chromePid: child.pid, directory, chromeCommand: chrome, chromeVersion: spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim(), browserVersion: browser.version(), startupMs: performance.now() - started });
    await use({ browser, child, chromePid: child.pid!, workerIndex });
  } finally {
    const cleanupStarted = performance.now();
    try {
      if (!exited && browser?.isConnected()) {
        const session = await browser.newBrowserCDPSession();
        await bounded(session.send('Browser.close').catch(() => {}), 1000, 'Chrome 关闭请求超时').catch(() => {});
      }
      if (!exited) await bounded(closed, 2000, 'Chrome 未退出').catch(async () => {
        child.kill('SIGTERM');
        await bounded(closed, 1000, 'Chrome SIGTERM 后未退出').catch(async () => { child.kill('SIGKILL'); await bounded(closed, 1000, 'Chrome SIGKILL 后未退出'); });
      });
      await browser?.close().catch(() => {});
      if (!exited) throw Error('Chrome 实际退出尚未确认');
      await removeDirectory(directory);
    } finally { record({ event: 'worker-stop', workerIndex, chromePid: child.pid, directory, chromeExited: exited, shutdownMs: performance.now() - cleanupStarted }); }
  }
}

async function dispatch(session: CDPSession, options: any, width: number) {
  const { key, shift, ctrl, meta, click, screenshot, pointer, button = 'left' } = options;
  const send = (method: string, params: any = {}): Promise<any> => session.send(method as any, params);
  if (screenshot) {
    if (process.env.PANEL_EVIDENCE_DIR) {
      const { data } = await send('Page.captureScreenshot');
      mkdirSync(process.env.PANEL_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.PANEL_EVIDENCE_DIR, `${width}-${screenshot}.png`), Buffer.from(data, 'base64'));
    }
  } else if (pointer) {
    let position = { x: pointer.x, y: pointer.y };
    if (pointer.selector) {
      const response = await send('Runtime.evaluate', { expression: `(() => { const node = document.querySelector(${JSON.stringify(pointer.selector)}); if (!node) throw Error('找不到拖拽目标'); const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height * ${pointer.fraction ?? 0.5} }; })()`, returnByValue: true });
      if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
      position = response.result.value;
    }
    if (pointer.type === 'mousePressed') await send('Input.dispatchMouseEvent', { ...position, type: 'mouseMoved', button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { ...position, type: pointer.type, ...(pointer.pointerType ? { pointerType: pointer.pointerType } : {}), button: pointer.type === 'mouseMoved' ? 'none' : button, buttons: pointer.buttons ?? (pointer.type === 'mouseReleased' ? 0 : button === 'right' ? 2 : 1), clickCount: 1, ...(pointer.type === 'mouseWheel' ? { deltaX: 0, deltaY: pointer.deltaY ?? 600 } : {}) });
  } else if (click) {
    const position = await send('Runtime.evaluate', { expression: `(() => { const node = document.querySelector(${JSON.stringify(click)}); if (!node) throw Error('找不到鼠标目标 ' + ${JSON.stringify(click)}); node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`, returnByValue: true });
    if (position.exceptionDetails) throw Error(JSON.stringify(position.exceptionDetails));
    const modifiers = (shift ? 8 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0);
    for (let count = 1; count <= (key === 'double' ? 2 : 1); count++) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position.result.value, button, clickCount: count, modifiers });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position.result.value, button, clickCount: count, modifiers });
    }
  } else {
    const code = ({ Tab: 9, Escape: 27, Enter: 13, ' ': 32, F2: 113, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 } as Record<string, number>)[key];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key === 'Enter' ? '\r' : key?.length === 1 ? key : undefined, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  }
}

class Panel {
  private contexts = new Set<BrowserContext>();
  private operations = new Set<Promise<void>>();
  private abort = new AbortController();
  private failures: unknown[] = [];
  constructor(private worker: ManagedBrowser, private info: TestInfo) {}
  check(script: string, fixture: string, width = 1600, height = 1000) {
    const operation = this.execute(script, fixture, width, height);
    this.operations.add(operation);
    void operation.catch(error => { this.failures.push(error); }).finally(() => this.operations.delete(operation));
    return operation;
  }
  private async execute(script: string, fixture: string, width: number, height: number) {
    const started = performance.now();
    const timings: Record<string, unknown> = { event: 'case', test: this.info.title, workerIndex: this.worker.workerIndex, chromePid: this.worker.chromePid, width, height };
    const directory = mkdtempSync(join(process.env.CLAPGRID_PLAYWRIGHT_RESOURCE_ROOT!, 'case-'));
    record({ event: 'case-start', test: this.info.title, directory, workerIndex: this.worker.workerIndex, chromePid: this.worker.chromePid });
    timings.directory = directory;
    let context: BrowserContext | undefined;
    try {
      let stage = performance.now();
      const bundle = await buildBrowserScript(directory, script, fixture);
      Object.assign(timings, { bundleMs: performance.now() - stage, bundleCacheHit: bundle.cacheHit, bundleIdentity: bundle.identity });
      stage = performance.now();
      const styles = await buildPanelStyles(directory);
      Object.assign(timings, { stylesMs: performance.now() - stage, stylesCacheHit: styles.cacheHit, stylesIdentity: styles.identity });
      if (this.abort.signal.aborted) throw Error('用例已取消');
      writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="test.css"><div id="root"></div><pre id="result" data-state="pending"></pre><script src="test.js"></script></html>');
      stage = performance.now();
      context = await this.worker.browser.newContext({ viewport: null }); this.contexts.add(context);
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      const { targetInfo } = await session.send('Target.getTargetInfo');
      Object.assign(timings, { contextId: targetInfo.browserContextId, pageId: targetInfo.targetId });
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
      await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await session.send('Emulation.setEmulatedMedia', { features: [] });
      await page.exposeBinding('browserInput', async (_, options) => dispatch(session, options, width));
      const errors: Error[] = [];
      page.on('pageerror', error => errors.push(error));
      page.on('crash', () => errors.push(Error('浏览器页面崩溃')));
      timings.contextMs = performance.now() - stage;
      stage = performance.now();
      await page.goto(pathToFileURL(join(directory, 'index.html')).href, { waitUntil: 'load' });
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.deepEqual(metrics, { width, height }, '真实页面视口必须对应原场景');
      timings.windowBounds = (await session.send('Browser.getWindowBounds', { windowId })).bounds;
      let result: string | undefined;
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline && !this.abort.signal.aborted) {
        if (errors.length) throw errors[0];
        result = await page.locator('#result').evaluate(node => node.outerHTML).catch(() => undefined);
        if (result && !result.includes('data-state="pending"')) break;
        await delay(50);
      }
      assert.deepEqual(errors, []);
      timings.interactionMs = performance.now() - stage;
      assert.match(result ?? '浏览器未返回结果', /data-state="passed"/, result);
    } finally {
      const stage = performance.now();
      if (context) { await context.close(); this.contexts.delete(context); timings.contextClosed = true; }
      await removeDirectory(directory);
      Object.assign(timings, { cleanupMs: performance.now() - stage, totalMs: performance.now() - started });
      record(timings);
    }
  }
  async dispose() {
    this.abort.abort();
    await Promise.all([...this.contexts].map(context => context.close()));
    await bounded(Promise.allSettled(this.operations), 5000, '用例清理未结束');
    if (this.failures.length) throw this.failures[0];
  }
}

export const test = base.extend<{ panel: Panel }, { managedBrowser: ManagedBrowser }>({
  managedBrowser: [async ({}, use, workerInfo) => managedBrowser(use, workerInfo.workerIndex), { scope: 'worker' }],
  panel: async ({ managedBrowser }, use, testInfo) => {
    const panel = new Panel(managedBrowser, testInfo);
    try { await use(panel); } finally { await panel.dispose(); }
  },
});
