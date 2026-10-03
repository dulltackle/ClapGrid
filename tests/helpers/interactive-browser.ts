import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { chrome } from './browser.js';

/** 真实浏览器按键用于原生焦点导航；业务替身仍只位于 HTTP 客户端边界。 */
export async function checkInteractiveBrowser(t: TestContext, script: string, fixture: string, width = 1600) {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-dialog-'));
  await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'tsx', contents: script },
    bundle: true, jsx: 'automatic', format: 'iife', outfile: join(directory, 'test.js'), define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'http-fixture', setup(builder) {
      builder.onResolve({ filter: /^(editing-fixture|\.\.\/shared\/client\.js)$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js' }));
    } }],
  });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="test.css"><div id="root"></div><pre id="result" data-state="pending"></pre><script src="test.js"></script></html>');
  const browser = spawn(chrome!, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let socket: WebSocket | undefined;
  const exited = new Promise(resolve => browser.once('exit', resolve));
  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
    else browser.kill();
    await exited; socket?.close();
    await delay(100);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port = '';
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    try { port = readFileSync(join(directory, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]!; }
    catch { await delay(50); }
  }
  assert.ok(port, 'Chrome 必须启动，不能将环境缺失记为通过');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  socket = new WebSocket(pages.find(page => page.type === 'page')!.webSocketDebuggerUrl);
  await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
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
        const { id: requestId, key, shift, screenshot } = JSON.parse(message.params.payload);
        if (screenshot) {
          if (process.env.PANEL_EVIDENCE_DIR) {
            const { data } = await send('Page.captureScreenshot');
            mkdirSync(process.env.PANEL_EVIDENCE_DIR, { recursive: true });
            writeFileSync(join(process.env.PANEL_EVIDENCE_DIR, `${width}-${screenshot}.png`), Buffer.from(data, 'base64'));
          }
        } else {
          const code = { Tab: 9, Escape: 27, Enter: 13, ' ': 32 }[key as string];
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
        }
        await send('Runtime.evaluate', { expression: `window.__inputDone(${requestId})` });
      })().catch(error => bindingErrors.push(error));
    }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Runtime.addBinding', { name: '__browserInput' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const pendingInput = new Map(); let nextInput = 0;
    window.__inputDone = id => { pendingInput.get(id)(); pendingInput.delete(id); };
    window.browserInput = options => new Promise(resolve => {
      pendingInput.set(++nextInput, resolve); window.__browserInput(JSON.stringify({ id: nextInput, ...options }));
    });
  ` });
  await send('Page.navigate', { url: pathToFileURL(join(directory, 'index.html')).href });
  let result;
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await send('Runtime.evaluate', { expression: 'document.getElementById("result")?.outerHTML', returnByValue: true });
    result = response.result.value;
    if (result && !result.includes('data-state="pending"')) break;
    assert.deepEqual(bindingErrors, []);
    await delay(50);
  }
  if (!result) { const page = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }); result = page.result.value; }
  assert.match(result ?? '浏览器未返回结果', /data-state="passed"/, result);
}
