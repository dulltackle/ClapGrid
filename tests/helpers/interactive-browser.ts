import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildBrowserScript, recordBrowserTimings, type BrowserTimings } from './browser-build.js';
import { buildPanelStyles } from './panel-styles.js';
import { chrome } from './browser.js';
import { waitForDevToolsPort } from './browser-startup.js';

/** 真实浏览器按键用于原生焦点导航；业务替身仍只位于 HTTP 客户端边界。 */
export async function checkInteractiveBrowser(t: TestContext, script: string, fixture: string, width = 1600, height = 1000, options: { colorScheme?: 'light' | 'dark'; reducedMotion?: boolean; resources?: Record<string, { body: Uint8Array; type: string }>; buildDefine?: Record<string, string> } = {}) {
  const started = performance.now();
  const timings: BrowserTimings = { width, height };
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-dialog-'));
  let browserManaged = false;
  t.after(() => {
    if (!browserManaged) {
      const cleanupStarted = performance.now();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      timings.cleanupMs = performance.now() - cleanupStarted; timings.totalMs = performance.now() - started;
      timings.failedBeforeBrowser = true; recordBrowserTimings(t, timings);
    }
  });
  let stageStarted = performance.now();
  const bundle = await buildBrowserScript(directory, script, fixture, options.buildDefine);
  timings.bundleMs = performance.now() - stageStarted; timings.bundleCacheHit = bundle.cacheHit; timings.bundleCacheLookupMs = bundle.cacheLookupMs; timings.bundleBuildMs = bundle.buildMs; timings.bundleCachePublishMs = bundle.cachePublishMs; timings.bundleCacheReason = bundle.cacheReason; timings.bundleCacheKey = bundle.cacheKey ?? 'unverified';
  timings.bundleIdentity = bundle.identity;
  stageStarted = performance.now();
  const styles = await buildPanelStyles(directory);
  timings.stylesMs = performance.now() - stageStarted; timings.stylesCacheHit = styles.cacheHit; timings.stylesCacheLookupMs = styles.cacheLookupMs; timings.stylesBuildMs = styles.buildMs; timings.stylesCachePublishMs = styles.cachePublishMs; timings.stylesCacheReason = styles.cacheReason; timings.stylesCacheKey = styles.cacheKey ?? 'unverified';
  timings.stylesIdentity = styles.identity;
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="test.css"><div id="root"></div><pre id="result" data-state="pending"></pre><script src="test.js"></script></html>');
  let pageUrl = pathToFileURL(join(directory, 'index.html')).href;
  if (options.resources) {
    const server = createServer((request, response) => {
      const resource = options.resources?.[request.url ?? ''];
      if (resource) {
        response.setHeader('Content-Type', resource.type); response.setHeader('Accept-Ranges', 'bytes');
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), resource.body.length - 1) : resource.body.length - 1;
        if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${resource.body.length}`); }
        response.setHeader('Content-Length', end - start + 1); response.end(resource.body.subarray(start, end + 1)); return;
      }
      const file = ({ '/': 'index.html', '/test.js': 'test.js', '/test.css': 'test.css' } as Record<string, string>)[request.url ?? ''];
      if (!file) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(readFileSync(join(directory, file)));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    pageUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    t.after(() => { server.closeAllConnections(); server.close(); });
  }
  // 旧版 Chrome 的滚轮命中仍受实际窗口边界限制，需与模拟视口同时设置。
  stageStarted = performance.now();
  const browser = spawn(chrome!, ['--headless', `--window-size=${width},${height}`, '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let socket: WebSocket | undefined;
  const exited = new Promise(resolve => browser.once('exit', resolve));
  browserManaged = true;
  t.after(async () => {
    const cleanupStarted = performance.now();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
    else browser.kill();
    await exited; socket?.close();
    await delay(100);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    timings.cleanupMs = performance.now() - cleanupStarted; timings.totalMs = performance.now() - started;
    recordBrowserTimings(t, timings);
  });
  const port = await waitForDevToolsPort(join(directory, 'profile', 'DevToolsActivePort'));
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  socket = new WebSocket(pages.find(page => page.type === 'page')!.webSocketDebuggerUrl);
  await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
  timings.chromeStartupMs = performance.now() - stageStarted; stageStarted = performance.now();
  let id = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params }));
  });
  const bindingErrors: unknown[] = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error))); else request?.resolve(message.result);
    } else if (message.method === 'Runtime.bindingCalled') {
      void (async () => {
        const { id: requestId, key, shift, ctrl, meta, click, screenshot, pointer, button = 'left' } = JSON.parse(message.params.payload);
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
          const code = { Tab: 9, Escape: 27, Enter: 13, ' ': 32, F2: 113, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 }[key as string];
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key === 'Enter' ? '\r' : key?.length === 1 ? key : undefined, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
        }
        await send('Runtime.evaluate', { expression: `window.__inputDone(${requestId})` });
      })().catch(error => bindingErrors.push(error));
    }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [...(options.colorScheme ? [{ name: 'prefers-color-scheme', value: options.colorScheme }] : []), ...(options.reducedMotion ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [])] });
  await send('Runtime.addBinding', { name: '__browserInput' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const pendingInput = new Map(); let nextInput = 0;
    window.__inputDone = id => { pendingInput.get(id)(); pendingInput.delete(id); };
    window.browserInput = options => new Promise(resolve => {
      pendingInput.set(++nextInput, resolve); window.__browserInput(JSON.stringify({ id: nextInput, ...options }));
    });
  ` });
  await send('Page.navigate', { url: pageUrl });
  let result;
  for (let attempt = 0; attempt < 600; attempt++) {
    const response = await send('Runtime.evaluate', { expression: 'document.getElementById("result")?.outerHTML', returnByValue: true });
    result = response.result.value;
    if (result && !result.includes('data-state="pending"')) break;
    assert.deepEqual(bindingErrors, []);
    await delay(50);
  }
  if (!result) { const page = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }); result = page.result.value; }
  timings.interactionMs = performance.now() - stageStarted;
  assert.match(result ?? '浏览器未返回结果', /data-state="passed"/, result);
}
