import { chromium, type Browser } from 'playwright-core';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants, openSync, fstatSync, closeSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { pageBrowserExecutable, pageBrowserVersion } from './page-browser.js';
import { styleStore } from './styles.mjs';
import { mediaProcess } from './media-process.js';
import { pageTexts, trackPageTexts } from './page-diagnostics.js';
import type { PageWorkerInput } from './page-worker-input.js';
import { pageStore } from './pages.js';

// Chrome 由本进程直接启动并继承进程组；守护进程的强制回收也覆盖浏览器后代。
const input = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as PageWorkerInput;
let browser: Browser | undefined; let chrome: ChildProcess | undefined; let encoder: ChildProcess | undefined;
let stopped = false; let failure: Error | undefined;
const failureListeners = new Set<(error: Error) => void>();
const guard = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const rejectOnFailure = (error: Error) => { failureListeners.delete(rejectOnFailure); reject(error); };
  failureListeners.add(rejectOnFailure);
  work.then(value => { failureListeners.delete(rejectOnFailure); resolve(value); }, rejectOnFailure);
  if (failure) rejectOnFailure(failure);
});
const fail = (message: string) => {
  if (!failure) {
    failure = new Error(message.slice(0, 1500));
    for (const reject of failureListeners) reject(failure);
  }
};
// 关闭各步必须有界：worker 不退出，父进程就一直视任务为进行中。
const STOP_GRACE_MS = 2000;
const within = (work: Promise<unknown>, ms: number) => new Promise<boolean>(resolve => {
  const timer = setTimeout(() => resolve(false), ms);
  work.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(true); });
});
// 等 exit 而非 close：浏览器后代继承 stderr，主进程退出后管道仍可能不关闭；后代由父进程按进程组回收。
const exited = (child: ChildProcess) => new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
async function ended(child: ChildProcess | undefined) {
  if (!child) return;
  if (!await within(exited(child), STOP_GRACE_MS)) { child.kill('SIGKILL'); await exited(child); }
  for (const stream of child.stdio) stream?.destroy();
}
async function stop() {
  stopped = true;
  if (browser) await within(browser.close(), 5000);
  // FFmpeg 阻塞读取 stdin 时不响应单个 SIGTERM，先断开输入使其读到 EOF。
  encoder?.stdin?.destroy();
  chrome?.kill('SIGTERM'); encoder?.kill('SIGTERM');
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
// 产品期限固定 120 秒（与 readyTimeoutSeconds 契约一致）；仅测试用此变量缩短 READY 超时用例的真实等待。
const readyTimeoutMs = Number(process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS) > 0 ? Number(process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS) : 120000;
const page = input.pageId ? pageStore(input.projectDirectory).read(input.pageId) : undefined;
const style = input.styleId ? styleStore(input.projectDirectory).read(input.styleId) : undefined;
const documentPath = page ? `/pages/${input.pageId}/index.html` : '/subtitle-host.html';
const subtitleHost = Buffer.from(`<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<canvas width="1920" height="1080"></canvas>
<script type="module">
  import * as style from '/style/lib/subtitle.js';
  if (typeof style.drawSubtitle !== 'function') throw new Error('字幕模块必须导出 drawSubtitle(ctx, text, t, duration)');
  const box = style.subtitleRegion;
  if (!box || typeof box !== 'object' || Array.isArray(box) ||
      Object.keys(box).length !== 4 || !['x','y','width','height'].every(key => Number.isFinite(box[key])) ||
      box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1920 || box.y + box.height > 1080) {
    throw new Error('字幕模块的 subtitleRegion 必须是 1920×1080 画布内的有效矩形');
  }
  const ctx = document.querySelector('canvas').getContext('2d');
  window.subtitleRegion = { x: box.x, y: box.y, width: box.width, height: box.height };
  window.setupSubtitle = (text, duration) => {
    window.DUR = duration;
    window.render = t => { ctx.reset(); return style.drawSubtitle(ctx, text, t, duration); };
  };
  await document.fonts.ready;
  window.READY = true;
</script>`);
const profile = await mkdtemp(join(input.output + '.browser-'));
const mime: Record<string, string> = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };
let origin = '';
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url!, origin);
    if (url.origin !== origin) throw new Error('页面禁止代理外部请求');
    const path = decodeURIComponent(url.pathname);
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new Error('只允许读取页面文件');
    const assetId = /^\/assets\/([a-f0-9-]{36})$/.exec(path)?.[1];
    if (assetId && input.assets[assetId]) {
      const asset = input.assets[assetId]; const fd = openSync(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) { closeSync(fd); throw new Error('页面素材文件不安全'); }
      response.writeHead(200, { 'Content-Type': asset.mime, 'Content-Length': stat.size });
      const stream = createReadStream('', { fd, autoClose: true }); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return;
    }
    const prefix = `/pages/${input.pageId}/`;
    const stylePrefix = '/style/';
    const file = !page && path === documentPath ? subtitleHost
      : page && path.startsWith(prefix) ? page.files.get(path.slice(prefix.length) || 'index.html')
      : style && path.startsWith(stylePrefix) ? style.files.get(path.slice(stylePrefix.length)) : undefined;
    if (!file) { fail(!style && path.startsWith(stylePrefix) ? `未设置项目风格，无法读取 ${path}` : `页面文件或素材未声明：${path}`); response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': (mime[path.split('.').at(-1)!.toLowerCase()] ?? 'application/octet-stream') + (['html', 'js', 'mjs', 'css', 'json', 'svg'].includes(path.split('.').at(-1)!.toLowerCase()) ? '; charset=utf-8' : '') }); response.end(file);
  } catch (error) { fail((error as Error).message); if (!response.headersSent) response.writeHead(404); response.end(); }
});
server.on('connect', (_request, socket) => { fail('页面禁止外部代理连接'); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
try {
  const executable = pageBrowserExecutable(chromium.executablePath());
  if (!execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim().endsWith(` ${pageBrowserVersion}`)) throw new Error(`页面浏览器版本必须为 ${pageBrowserVersion}`);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  chrome = spawn(executable, ['--headless', '--no-sandbox', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', `--proxy-server=${origin}`, '--proxy-bypass-list=127.0.0.1', '--disable-gpu', '--disable-webgl', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-first-run', '--disable-sync', '--disable-breakpad', '--force-color-profile=srgb', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stderr = ''; const timer = setTimeout(() => reject(new Error('页面浏览器启动超时')), 30000);
    chrome!.on('error', reject); chrome!.once('close', () => { clearTimeout(timer); reject(new Error('页面浏览器启动失败：' + stderr.slice(-1000))); });
    chrome!.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1]; if (endpoint) { clearTimeout(timer); resolve(endpoint); } });
  });
  if (stopped) throw new Error('页面渲染已取消');
  browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext({ viewport: { width: input.width, height: input.height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  context.setDefaultTimeout(120000);
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) { fail(`页面禁止外部请求：${route.request().url().split('?')[0]}`); await route.abort(); }
    else await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { fail(`页面禁止 WebSocket 请求：${socket.url().split('?')[0]}`); socket.close(); });
  await context.exposeBinding('__clapgridPageViolation', (_source, message: string) => fail(message));
  await context.addInitScript(() => {
    const report = (window as any).__clapgridPageViolation;
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
      Object.defineProperty(window, name, { configurable: false, get() {
        void report('页面禁止 WebRTC 网络访问');
        throw new Error('页面禁止 WebRTC 网络访问');
      } });
    }
    document.addEventListener('securitypolicyviolation', event => console.error(`页面禁止外部请求或能力：${event.blockedURI}`));
  });
  const openPage = async () => {
    const tab = await context.newPage();
    tab.on('pageerror', error => fail(`页面脚本错误：${error.message}`));
    tab.on('console', message => { if (message.type() === 'error') fail(`${message.text().includes('Content Security Policy') ? '页面禁止外部请求或能力' : '页面错误'}：${message.text()}`); });
    tab.on('requestfailed', request => fail(`页面加载失败：${request.url().split('?')[0]} ${request.failure()?.errorText}`));
    const deadline = Date.now() + readyTimeoutMs;
    const remaining = () => Math.max(1, deadline - Date.now());
    await guard(tab.goto(`${origin}${documentPath}`, { waitUntil: 'domcontentloaded', timeout: remaining() }));
    try { await guard(tab.waitForFunction(() => (window as any).READY === true, undefined, { timeout: remaining() })); }
    catch { throw new Error(failure?.message ?? `页面 READY 等待超时（${readyTimeoutMs / 1000} 秒）`); }
    if (!page) await guard(tab.evaluate(({ text, duration }) => (window as any).setupSubtitle(text, duration), { text: input.subtitleText, duration: input.duration }));
    const valid = await tab.evaluate(duration => typeof (window as any).render === 'function' && Number.isFinite((window as any).DUR) && Math.abs((window as any).DUR - duration) <= 0.001, input.duration);
    if (!valid) throw new Error(`页面 DUR 必须等于图层区间 ${input.duration} 秒（误差 ≤1 ms），并暴露 render(t)`);
    return tab;
  };
  const instances = await Promise.all(Array.from({ length: input.diagnostic && input.diagnostic.kind !== 'check' ? 1 : 2 }, openPage));
  if (failure) throw failure;
  const frames = input.subtitleText === undefined ? Math.round(input.duration * input.fps) : Math.ceil(input.duration * input.fps);
  if (frames < 1) throw new Error('页面图层区间不足一帧');
  if (input.diagnostic) {
    const diagnostic = input.diagnostic;
    const tab = instances[0]!;
    const render = (instance: typeof tab, time: number) => guard(instance.evaluate(t => (window as any).render(t), time));
    const screenshot = (instance: typeof tab, path: string) => guard(instance.screenshot({ path, type: 'png', omitBackground: input.transparent, timeout: 120000 }));
    if (diagnostic.kind === 'subtitle-region') {
      const box = await guard(tab.evaluate(() => (window as any).subtitleRegion));
      await writeFile(input.output, JSON.stringify(box), { flag: 'wx' });
    } else if (diagnostic.kind === 'frames') {
      for (const [index, time] of diagnostic.times.entries()) {
        if (stopped) throw new Error('页面抽帧已取消');
        await render(tab, time);
        await screenshot(tab, join(input.output, `frame-${index}.png`));
      }
    } else {
      // 两个独立页面实例使用不同顺序；比较解码后的 RGBA 像素。
      const samples = [...new Set([Math.floor(frames / 2), 0, frames - 1])];
      const hashes: Map<number, string>[] = [];
      for (const [index, instance] of instances.entries()) {
        const result = new Map<number, string>();
        for (const frame of index === 0 ? samples : [...samples].reverse()) {
          if (stopped) throw new Error('页面检查已取消');
          await render(instance, frame / input.fps);
          const path = join(profile, 'sample.png');
          await screenshot(instance, path);
          const { stdout } = await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-threads', '1', '-i', path, '-pix_fmt', 'rgba', '-c:v', 'rawvideo', '-threads', '1', '-f', 'hash', '-hash', 'sha256', '-']);
          result.set(frame, stdout.trim());
        }
        hashes.push(result);
      }
      const mismatchedTimes = samples.filter(frame => hashes[0]!.get(frame) !== hashes[1]!.get(frame)).sort((a, b) => a - b).map(frame => frame / input.fps);
      const available = await guard(tab.evaluate(() => typeof (window as any).TEXTS === 'function'));
      const tracker = trackPageTexts({ ...diagnostic, duration: input.duration, fps: input.fps });
      if (available) {
        // 新页面从初始状态按时间顺序取样，不继承乱序抽检的状态。
        const textTab = await openPage();
        for (let frame = 0; frame < frames; frame++) {
          if (stopped) throw new Error('页面检查已取消');
          const time = frame / input.fps;
          await render(textTab, time);
          const raw = await guard(textTab.evaluate(t => (window as any).TEXTS(t), time));
          const parsed = pageTexts.safeParse(raw);
          if (!parsed.success) throw new Error(`TEXTS(${time}) 必须返回有效的文字和页面像素框数组`);
          tracker.frame(frame, parsed.data);
        }
      }
      await writeFile(input.output, JSON.stringify({
        text: available ? tracker.result() : { status: 'not-checked', issues: [], reason: '页面没有提供 TEXTS(t)' },
        determinism: { sampledTimes: [...samples].sort((a, b) => a - b).map(frame => frame / input.fps), mismatchedTimes,
          warnings: mismatchedTimes.length ? ['跨实例乱序渲染像素不一致，成片可能随机闪烁或跳帧。请检查无种子随机数、当前时间或依赖上一帧状态的代码。'] : [] },
      }), { flag: 'wx' });
    }
  } else {
    let encoderError = '';
    encoder = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-f', 'image2pipe', '-framerate', String(input.fps), '-vcodec', input.transparent ? 'png' : 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', input.transparent ? 'bgra' : 'bgr0', '-threads', '2', '-f', 'matroska', input.output], { stdio: ['pipe', 'ignore', 'pipe'] });
    const encoded = new Promise<void>((resolve, reject) => {
      encoder!.on('error', reject); encoder!.stderr!.on('data', chunk => { encoderError = (encoderError + chunk.toString()).slice(-1500); });
      encoder!.once('close', code => code === 0 ? resolve() : reject(new Error(`页面帧编码失败：${encoderError}`)));
      encoder!.stdin!.on('error', reject);
    });
    // 提前绑定拒绝处理；按两帧为一批分配，保持输出顺序及有界内存。
    void encoded.catch(error => fail((error as Error).message));
    async function writeFrame(bytes: Buffer) {
      if (encoder!.stdin!.write(bytes)) return;
      await new Promise<void>((resolve, reject) => {
        const stream = encoder!.stdin!;
        const cleanup = () => { stream.off('drain', drained); stream.off('error', errored); stream.off('close', closed); encoder!.off('close', closed); };
        const drained = () => { cleanup(); resolve(); };
        const errored = (error: Error) => { cleanup(); reject(error); };
        const closed = () => errored(new Error(`页面编码提前结束：${encoderError}`));
        stream.once('drain', drained); stream.once('error', errored); stream.once('close', closed); encoder!.once('close', closed);
      });
    }
    for (let frame = 0; frame < frames; frame += instances.length) {
      if (stopped) throw new Error('页面渲染已取消');
      const batch = await Promise.all(instances.slice(0, frames - frame).map(async (tab, slot) => {
        const time = (frame + slot) / input.fps;
        if (!page) {
          // 字幕模块只绘制 Canvas，直接读取透明像素，省去整页截图。
          const png = await guard(tab.evaluate(async t => {
            await (window as any).render(t);
            return document.querySelector('canvas')!.toDataURL('image/png');
          }, time));
          return Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
        }
        await guard(tab.evaluate(t => (window as any).render(t), time));
        return guard(tab.screenshot({ type: input.transparent ? 'png' : 'jpeg', ...(input.transparent ? { omitBackground: true } : { quality: 100 }), timeout: 120000 }));
      }));
      if (failure) throw failure;
      for (const bytes of batch) await writeFrame(bytes);
    }
    encoder.stdin!.end(); await encoded;
  }
  if (failure) throw failure;
} catch (error) {
  console.error((error as Error).message); process.exitCode = 1;
} finally {
  await stop(); await Promise.all([ended(chrome), ended(encoder)]);
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await rm(profile, { recursive: true, force: true });
}
