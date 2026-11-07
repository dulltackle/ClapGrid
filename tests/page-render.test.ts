import { test } from './helpers/resource-test.js';
import { expect, onTestFinished } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fullPage, pageProject } from './helpers/page-project.js';

test('页面背景与字幕逐帧合成，文案变化仅重渲字幕层', async ({ createDirectory, execBytes, execText, startService, onTestFinished }) => {
  const ffmpeg = (await execText('which', ['ffmpeg'], { encoding: 'utf8' })).trim();
  const bin = createDirectory(join(tmpdir(), 'clapgrid-render-observer-'));
  const calls = join(bin, 'renders.log');
  writeFileSync(join(bin, 'ffmpeg'), `#!/bin/bash
case "\${!#}" in
  */page-[0-9]*.mkv) echo page >> "$CLAPGRID_RENDER_LOG" ;;
  */subtitle-[0-9]*.mkv) echo subtitle >> "$CLAPGRID_RENDER_LOG" ;;
esac
exec "$CLAPGRID_RENDER_FFMPEG" "$@"
`, { mode: 0o700 });
  const env = { PATH: `${bin}:${process.env.PATH}`, CLAPGRID_RENDER_FFMPEG: ffmpeg, CLAPGRID_RENDER_LOG: calls };
  const previous = Object.keys(env).map(name => [name, process.env[name]] as const);
  Object.assign(process.env, env);
  onTestFinished(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, true);
  const pageId = await p.importPage(`window.render=t=>{document.body.style.background=t<0.5?'red':'lime'};window.READY=true`);
  await p.save([fullPage(pageId, p.duration)]);
  const preview = await p.task(); expect(preview, JSON.stringify(preview)).toMatchObject({ state: 'succeeded', current: true });
  const result = join(p.root, 'result.mp4');
  async function check(task: typeof preview) {
    writeFileSync(result, Buffer.from(await (await fetch(p.service.url + task.output!.url)).arrayBuffer()));
    const media = JSON.parse(await execText('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result], { encoding: 'utf8' }));
    expect(media.streams).toEqual(expect.arrayContaining([expect.objectContaining({ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1' }), expect.objectContaining({ codec_type: 'audio' })]));
    expect(Math.abs(Number(media.format.duration) - p.duration)).toBeLessThan(0.05);
    const caption = await execBytes('ffmpeg', ['-v', 'error', '-i', result, '-frames:v', '1', '-vf', 'crop=700:100:112:920', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let white = 0;
    for (let i = 0; i < caption.length; i += 3) if (caption[i]! > 220 && caption[i + 1]! > 220 && caption[i + 2]! > 220) white++;
    expect(white).toBeGreaterThan(30);
    for (const [time, channel] of [[0.2, 0], [0.7, 1]]) {
      const pixel = await execBytes('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', result, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      expect(pixel[channel!]!).toBeGreaterThan(220);
    }
  }
  await check(preview);
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['page', 'subtitle']);
  const full = await p.task('export'); expect(full.state).toBe('succeeded'); await check(full);
  const { snapshot } = await fetch(p.service.url + '/api/status').then(r => r.json());
  await p.post('/api/codex/modify', { changes: [{ kind: 'edit', expected: snapshot.segments[0], text: '新文案' }] });
  await p.post('/api/speech/submit', { requestId: crypto.randomUUID(), segmentId: p.segmentId });
  await expect.poll(async () => (await fetch(p.service.url + '/api/speech').then(r => r.json())).audio.length).toBe(2);
  const changed = await p.task();
  expect(changed, JSON.stringify(changed)).toMatchObject({ state: 'succeeded', current: true });
  writeFileSync(result, Buffer.from(await (await fetch(p.service.url + changed.output!.url)).arrayBuffer()));
  const mark = await execBytes('ffmpeg', ['-v', 'error', '-i', result, '-frames:v', '1', '-vf', 'crop=2:2:90:950,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  expect(mark[0]).toBeLessThan(30);
  expect(mark[1]).toBeGreaterThan(220);
  expect(mark[2]).toBeGreaterThan(220);
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['page', 'subtitle', 'subtitle']);
  const next = await p.importPage(`window.render=t=>{document.body.style.background='blue'};window.READY=true`);
  await p.save([fullPage(next, p.duration)]);
  expect((await fetch(p.service.url + '/api/visual-previews').then(r => r.json())).tasks[0].current).toBe(false);
}, 60000);

test('透明页面按局部时间与层级叠加，透明区域保留下层视频', async ({ createDirectory, execBytes, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  const video = join(p.root, 'blue.mp4');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64:d=1:r=25', '-c:v', 'libx264', video]);
  const asset = (await p.post('/api/codex/import-material', { sourcePath: video })).asset;
  const pageId = await p.importPage(`window.DUR=0.6;window.render=t=>{document.body.innerHTML='<div style="position:absolute;left:0;top:0;width:50%;height:100%;background:'+(t<0.3?'red':'lime')+'"></div>'};window.READY=true`);
  await p.save([
    { assetId: asset.id, role: 'background', from: 0, to: p.duration, start: 0, x: 0, y: 0, width: 1, height: 1, z: 0 },
    { ...fullPage(pageId, p.duration), role: 'overlay', z: 1, from: 0.2, to: 0.8, x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  ], [asset.id]);
  const task = await p.task();
  expect(task, JSON.stringify(task)).toMatchObject({ state: 'succeeded', current: true, preview: { subtitleIssue: '未设置项目风格，预览不含字幕' } });
  const check = await p.post('/api/page/check', { segmentId: p.segmentId });
  expect(check.subtitle).toEqual({ status: 'not-checked', reason: '未设置项目风格' });
  const result = join(p.root, 'transparent.mp4'); writeFileSync(result, Buffer.from(await (await fetch(p.service.url + task.output!.url)).arrayBuffer()));
  async function pixel(t: number, x: number, y: number) {
    return [...await execBytes('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', result, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  }
  expect((await pixel(0.1, 600, 400))[2]).toBeGreaterThan(220);
  expect((await pixel(0.4, 600, 400))[0]).toBeGreaterThan(220);
  expect((await pixel(0.6, 600, 400))[1]).toBeGreaterThan(220);
  expect((await pixel(0.4, 1200, 400))[2]).toBeGreaterThan(220);
  expect((await pixel(0.9, 600, 400))[2]).toBeGreaterThan(220);
}, 60000);

for (const [name, script, reason] of [
  ['加载脚本报错', `throw new Error('加载失败样例')`, '加载失败样例'],
  ['render 抛错', `window.render=t=>{throw new Error('渲染失败样例')};window.READY=true`, '渲染失败样例'],
  // 延迟抛错时编码器已启动并阻塞读取 stdin，单个 SIGTERM 不能使其退出。
  ['render 延迟抛错', `window.render=t=>new Promise((_,reject)=>setTimeout(()=>reject(new Error('延迟渲染失败样例')),1000));window.READY=true`, '延迟渲染失败样例'],
  ['DUR 不一致', `window.DUR=8;window.render=t=>{};window.READY=true`, 'DUR'],
  ['外部 fetch', `fetch('https://example.invalid/secret').catch(()=>{});window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['外部图片', `document.write('<img src="https://example.invalid/pixel.png">');window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['任意本机文件', `fetch('file:///etc/passwd').catch(()=>{});window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['未声明素材', `fetch('/assets/00000000-0000-4000-8000-000000000000').catch(()=>{});window.render=t=>{};window.READY=true`, '未声明'],
  ['READY 超时', `window.render=t=>{};`, 'READY 等待超时'],
] as const) {
  test(`页面${name}使任务失败，并指明片段和原因`, async ({ createDirectory, execBytes, startService }) => {
    if (name === 'READY 超时') {
      // 产品期限为 120 秒；超时路径与期限长短无关，缩短后只省掉真实等待。
      const previous = process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS; process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS = '5000';
      onTestFinished(() => { if (previous === undefined) delete process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS; else process.env.CLAPGRID_TEST_PAGE_READY_TIMEOUT_MS = previous; });
    }
    const p = await pageProject({ createDirectory, execBytes, startService });
    const pageId = await p.importPage(script); await p.save([fullPage(pageId, p.duration)]);
    const submitted = await p.post('/api/visual-previews/submit', { segmentId: p.segmentId });
    let task: any;
    await expect.poll(async () => {
      task = (await fetch(p.service.url + '/api/visual-previews').then(r => r.json())).tasks.find((t: any) => t.id === submitted.id); return task?.state;
    }, { timeout: 60000 }).toBe('failed');
    expect(task.issues).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId: p.segmentId, order: 1, message: expect.stringContaining(reason) })]));
    expect(task.output).toBeUndefined();
  }, 90000);
}

test('页面声明的本句素材计入编排覆盖，并通过固定原件地址读取', async ({ createDirectory, execBytes, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  const path = join(p.root, 'red.png');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x32', '-frames:v', '1', path]);
  const asset = (await p.post('/api/codex/import-material', { sourcePath: path })).asset;
  const pageId = await p.importPage(`const img=new Image;img.onload=()=>window.READY=true;img.src='/assets/${asset.id}';window.render=t=>{document.body.style.backgroundImage='url('+img.src+')';document.body.style.height='100vh'}`);
  await p.save([{ ...fullPage(pageId, p.duration), kind: 'page', assetIds: [asset.id] }], [asset.id]);
  const context = await fetch(p.service.url + '/api/visual-context/' + p.segmentId).then(r => r.json());
  expect(context.page).toMatchObject({ canvas: { width: 1920, height: 1080 }, fps: 25, assetUrls: { [asset.id]: `/assets/${asset.id}` } });
  const task = await p.task(); expect(task, JSON.stringify(task)).toMatchObject({ state: 'succeeded' });
  const result = join(p.root, 'asset-page.mp4'); writeFileSync(result, Buffer.from(await (await fetch(p.service.url + task.output!.url)).arrayBuffer()));
  const pixel = await execBytes('ffmpeg', ['-v', 'error', '-i', result, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  expect(pixel[0]).toBeGreaterThan(220);
}, 60000);

for (const mode of ['cancel', 'crash'] as const) {
  test(`页面渲染中${mode === 'cancel' ? '取消' : '服务崩溃'}后浏览器与临时文件退出，重开可取得媒体锁`, async ({ createDirectory, execBytes, startService, command, ownProcess }) => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const { resolve } = await import('node:path');
    const { processIdentity, rememberDescendants, ownerAlive } = await import(new URL('./helpers/product-process.mjs', import.meta.url).href);
    const p = await pageProject({ createDirectory, execBytes, startService });
    const pageId = await p.importPage(`window.render=t=>new Promise(()=>{});window.READY=true`);
    await p.save([fullPage(pageId, p.duration)]);
    let url = p.service.url;
    let parent = processIdentity(process.pid);
    let running: ReturnType<typeof command> | undefined;
    if (mode === 'crash') {
      await p.service.close();
      const code = `import {startService} from ${JSON.stringify(pathToFileURL(resolve('src/service/server.ts')).href)};const s=await startService(${JSON.stringify({ ...p.options, speechRuntime: undefined })});console.log(JSON.stringify({url:s.url}));`;
      running = command(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { timeout: 60000 });
      let output = ''; running.child.stdout!.on('data', chunk => { output += chunk; });
      await expect.poll(() => { try { return JSON.parse(output).url; } catch { return undefined; } }).toBeTruthy();
      url = JSON.parse(output).url; parent = processIdentity(running.child.pid);
    }
    const owners = new Map([[parent.pid, parent]]);
    const post = async (path: string, input: unknown) => (await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
    const task = await post('/api/visual-previews/submit', { segmentId: p.segmentId });
    let browsers: any[] = [];
    await expect.poll(() => {
      rememberDescendants(owners);
      browsers = [...owners.values()].filter(owner => {
        try { return readFileSync(`/proc/${owner.pid}/comm`, 'utf8').startsWith('chrome-headless'); } catch { return false; }
      }); const encoding = [...owners.values()].some(owner => { try { return readFileSync(`/proc/${owner.pid}/comm`, 'utf8').trim() === 'ffmpeg'; } catch { return false; } }); return encoding ? browsers.length : 0;
    }, { timeout: 20000 }).toBeGreaterThan(0);
    for (const owner of [...owners.values()].filter(owner => owner.pid !== process.pid)) ownProcess(() => owner);
    if (mode === 'cancel') {
      await post('/api/exports/cancel', { taskId: task.id });
      await expect.poll(async () => (await fetch(url + '/api/visual-previews').then(r => r.json())).tasks.find((t: any) => t.id === task.id).state).toBe('cancelled');
      expect((await fetch(url + '/api/status').then(r => r.json())).taskLocked).toBe(false);
      await p.service.close();
    } else {
      running!.child.kill('SIGKILL');
      // 不等待命令 fixture 回收后代来证明产品回收：先独立观察浏览器消失。
    }
    await expect.poll(() => browsers.every(owner => ownerAlive(owner) === false), { timeout: 10000 }).toBe(true);
    const reopened = await startService(p.options);
    await expect.poll(async () => (await fetch(reopened.url + '/api/visual-previews').then(r => r.json())).tasks.find((t: any) => t.id === task.id).state).toBe(mode === 'cancel' ? 'cancelled' : 'interrupted');
    expect(readdirSync(join(p.root, 'project', 'exports')).filter(name => name.startsWith('.work-'))).toEqual([]);
    expect((await fetch(reopened.url + '/api/status').then(r => r.json())).taskLocked).toBe(false);
    if (running) await running;
  }, 60000);
}

test('页面不能绕过请求拦截用 WebRTC 向未声明 UDP 目标发送数据', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const { createSocket } = await import('node:dgram');
  const socket = createSocket('udp4');
  openConnection(() => ({ close: () => new Promise<void>(resolve => socket.close(() => resolve())) }));
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve));
  let packets = 0; socket.on('message', () => { packets++; });
  const p = await pageProject({ createDirectory, execBytes, startService });
  const attack = `try {console.error=()=>{};const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${socket.address().port}'}]});pc.createDataChannel('x');pc.createOffer().then(o=>pc.setLocalDescription(o));}catch{}`;
  const attempts = [attack,
    `const f=document.createElement('iframe');document.documentElement.append(f);try{const pc=new f.contentWindow.RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${socket.address().port}'}]});pc.createDataChannel('x');pc.createOffer().then(o=>pc.setLocalDescription(o));}catch{}`,
    `const f=document.createElement('iframe');f.srcdoc=${JSON.stringify('<script>' + attack + '</script>').replaceAll('<', '\\u003c')};document.documentElement.append(f);`,
  ];
  for (const script of attempts) {
    const pageId = await p.importPage(`${script};window.render=t=>{};window.READY=true`);
    await p.save([fullPage(pageId, p.duration)]);
    const task = await p.task();
    expect(task.issues, JSON.stringify(task)).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId: p.segmentId, message: expect.stringContaining('禁止') })]));
    expect(task.state).toBe('failed'); expect(task.output).toBeUndefined(); expect(packets).toBe(0);
  }
}, 60000);

test('页面通过稳定路径引用项目风格，换风格后原页面可继续渲染且旧预览待更新', async ({ createDirectory, execBytes, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, true);
  const pageDirectory = join(p.root, 'styled-page'); mkdirSync(pageDirectory);
  writeFileSync(join(pageDirectory, 'index.html'), readFileSync(join(p.styleDirectory, 'example/index.html'), 'utf8').replace('window.DUR=1;', `window.DUR=${p.duration};`));
  const pageId = (await p.post('/api/codex/import-page', { sourceDirectory: pageDirectory })).page.pageId;
  await p.save([fullPage(pageId, p.duration)]);
  async function check(channel: number) {
    const preview = await p.task();
    expect(preview, JSON.stringify(preview)).toMatchObject({ state: 'succeeded', current: true });
    const output = join(p.root, 'styled.mp4');
    writeFileSync(output, Buffer.from(await (await fetch(p.service.url + preview.output!.url)).arrayBuffer()));
    const pixel = await execBytes('ffmpeg', ['-v', 'error', '-ss', '0.2', '-i', output, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    expect(pixel[channel]).toBeGreaterThan(220);
  }
  await check(0);
  writeFileSync(join(p.styleDirectory, 'lib/color.js'), `export const color=t=>'blue';`);
  await p.setStyle(p.styleDirectory);
  expect((await fetch(p.service.url + '/api/visual-previews').then(r => r.json())).tasks[0].current).toBe(false);
  await check(2);
}, 60000);

for (const styled of [false, true]) test(`页面请求未开放的风格路径使任务失败并指明片段（项目有风格：${styled}）`, async ({ createDirectory, execBytes, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, styled);
  const path = styled ? '/styles/' + 'a'.repeat(64) + '/lib/color.js' : '/style/lib/color.js';
  const pageId = await p.importPage(`fetch('${path}').catch(()=>{});window.render=t=>{};window.READY=true`);
  await p.save([fullPage(pageId, p.duration)]);
  const task = await p.task(); expect(task.state).toBe('failed'); expect(task.output).toBeUndefined();
  expect(task.issues).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId: p.segmentId, order: 1, message: expect.stringContaining(path) })]));
}, 60000);

for (const [module, reason] of [
  ['export const subtitleRegion = { x: 0, y: 0, width: 32, height: 32 };', 'drawSubtitle'],
  ['export const subtitleRegion = { x: 1910, y: 0, width: 32, height: 32 }; export function drawSubtitle() {}', '有效矩形'],
  ['export const subtitleRegion = [0, 0, 32, 32]; export function drawSubtitle() {}', '有效矩形'],
]) test(`非法字幕模块使渲染任务失败并定位片段（${module}）`, async ({ createDirectory, execBytes, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  writeFileSync(join(p.styleDirectory, 'lib/subtitle.js'), module!);
  await p.setStyle(p.styleDirectory);
  const pageId = await p.importPage('window.render=()=>{};window.READY=true');
  await p.save([fullPage(pageId, p.duration)]);
  const task = await p.task();
  expect(task).toMatchObject({ state: 'failed', segmentId: p.segmentId });
  expect(task.issues).toContainEqual(expect.objectContaining({ segmentId: p.segmentId, message: expect.stringContaining(reason!) }));
}, 60000);

test('页面自检报告文字与随机画面问题，抽帧保留透明，预览和导出仍可执行', async ({ createDirectory, execBytes, execText, startService, openConnection }) => {
  const p = await pageProject({ createDirectory, execBytes, startService }, 2, true);
  const background = await p.importPage('window.render=()=>{};window.READY=true');
  const overlay = await p.importPage(`window.render=()=>{document.body.innerHTML='<div style="width:8px;height:8px;background:rgb('+Array.from({length:3},()=>Math.floor(Math.random()*256)).join(',')+')"></div>'};
    window.TEXTS=t=>t<0.2?[{text:'画面文字',x:-3,y:1000,width:1000,height:60}]:[];window.READY=true`);
  await p.save([fullPage(background, p.duration), { ...fullPage(overlay, p.duration), role: 'overlay', z: 1, x: 3 / 1920, width: 0.9 }]);
  const input = { segmentId: p.segmentId, layerIndex: 1 };
  const before = (await fetch(p.service.url + '/api/status').then(r => r.json())).snapshot;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createBusinessMcp } = await import('../src/mcp/server.js');
  const server = openConnection(() => createBusinessMcp(p.service.url));
  const client = openConnection(() => new Client({ name: '页面自检测试', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const checkedResult = await client.callTool({ name: 'clapgrid_check_page', arguments: input });
  expect(checkedResult.isError, JSON.stringify(checkedResult)).not.toBe(true);
  const { layers: [checked] } = checkedResult.structuredContent as { layers: any[] };
  expect(checked.text.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'reading-time', text: '画面文字', from: 0, to: 0.2, requiredSeconds: expect.any(Number) }),
    expect.objectContaining({ kind: 'out-of-frame', box: { x: -1, y: 1000, width: 1000, height: 60 } }),
    expect.objectContaining({ kind: 'subtitle-overlap' }),
  ]));
  expect(checked.determinism.warnings[0]).toMatch(/闪烁或跳帧.*随机数.*上一帧/);
  const { layers: [unchecked] } = await p.post('/api/page/check', { ...input, layerIndex: 0 });
  expect(unchecked).toMatchObject({ text: { status: 'not-checked' }, determinism: { warnings: [] } });
  const framesResult = await client.callTool({ name: 'clapgrid_page_frames', arguments: { ...input, sampling: { times: [0.2, 0.4] } } });
  expect(framesResult.isError, JSON.stringify(framesResult)).not.toBe(true);
  const { frames } = framesResult.structuredContent as { frames: { time: number; path: string }[] };
  expect(frames.map((frame: { time: number }) => frame.time)).toEqual([0.2, 0.4]);
  const image = JSON.parse(await execText('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', frames[0]!.path], { encoding: 'utf8' }));
  expect(image.streams[0]).toMatchObject({ width: 1728, height: 1080, pix_fmt: 'rgba' });
  const pixels = await execBytes('ffmpeg', ['-v', 'error', '-i', frames[0]!.path, '-vf', 'crop=16:2:0:0,alphaextract', '-frames:v', '1', '-f', 'rawvideo', '-']);
  expect([pixels[0], pixels[12]]).toEqual([255, 0]);
  const interval = await p.post('/api/page/frames', { ...input, sampling: { from: 0, to: 0.6, interval: 0.2 } });
  expect(interval.frames.map((frame: { time: number }) => frame.time)).toEqual([0, 0.2, 0.4, 0.6]);
  const excessive = await fetch(p.service.url + '/api/page/frames', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, sampling: { from: 0, to: 0.6, interval: 0.001 } }),
  });
  expect(excessive.status).toBe(400);
  expect((await excessive.json()).error).toMatch(/60 帧/);
  expect((await fetch(p.service.url + '/api/status').then(r => r.json())).snapshot).toEqual(before);
  expect((await p.task()).state).toBe('succeeded');
  expect((await p.task('export')).state).toBe('succeeded');
  const good = await p.importPage("window.render=()=>{};window.TEXTS=()=>[{text:'A',x:20,y:20,width:16,height:20}];window.READY=true");
  await p.save([fullPage(good, p.duration)]);
  const { layers: [passed] } = await p.post('/api/page/check', { segmentId: p.segmentId });
  expect(passed).toMatchObject({ text: { status: 'passed', issues: [] }, determinism: { warnings: [] } });
}, 60000);
