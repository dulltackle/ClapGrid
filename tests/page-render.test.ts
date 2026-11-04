import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fullPage, pageProject } from './helpers/page-project.js';

test('页面背景在片段合成预览与全片导出中逐帧渲染，换用新页面身份使旧预览待更新', async ({ createDirectory, execBytes, execText, startService }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  const pageId = await p.importPage(`window.render=t=>{document.body.style.background=t<0.5?'red':'lime'};window.READY=true`);
  await p.save([fullPage(pageId, p.duration)]);
  const preview = await p.task(); expect(preview, JSON.stringify(preview)).toMatchObject({ state: 'succeeded', current: true });
  const result = join(p.root, 'result.mp4');
  async function check(task: typeof preview) {
    writeFileSync(result, Buffer.from(await (await fetch(p.service.url + task.output!.url)).arrayBuffer()));
    const media = JSON.parse(await execText('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result], { encoding: 'utf8' }));
    expect(media.streams).toEqual(expect.arrayContaining([expect.objectContaining({ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1' }), expect.objectContaining({ codec_type: 'audio' })]));
    expect(Math.abs(Number(media.format.duration) - p.duration)).toBeLessThan(0.05);
    const caption = await execBytes('ffmpeg', ['-v', 'error', '-i', result, '-frames:v', '1', '-vf', 'crop=700:100:610:920', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let white = 0;
    for (let i = 0; i < caption.length; i += 3) if (caption[i]! > 220 && caption[i + 1]! > 220 && caption[i + 2]! > 220) white++;
    expect(white).toBeGreaterThan(30);
    for (const [time, channel] of [[0.2, 0], [0.7, 1]]) {
      const pixel = await execBytes('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', result, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      expect(pixel[channel!]!).toBeGreaterThan(220);
    }
  }
  await check(preview); const full = await p.task('export'); expect(full.state).toBe('succeeded'); await check(full);
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
  const task = await p.task(); expect(task, JSON.stringify(task)).toMatchObject({ state: 'succeeded', current: true });
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
  ['DUR 不一致', `window.DUR=8;window.render=t=>{};window.READY=true`, 'DUR'],
  ['外部 fetch', `fetch('https://example.invalid/secret').catch(()=>{});window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['外部图片', `document.write('<img src="https://example.invalid/pixel.png">');window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['任意本机文件', `fetch('file:///etc/passwd').catch(()=>{});window.render=t=>{};window.READY=true`, '禁止外部请求'],
  ['未声明素材', `fetch('/assets/00000000-0000-4000-8000-000000000000').catch(()=>{});window.render=t=>{};window.READY=true`, '未声明'],
  ['READY 超时', `window.render=t=>{};`, 'READY 等待超时'],
] as const) {
  test(`页面${name}使任务失败，并指明片段和原因`, async ({ createDirectory, execBytes, startService }) => {
    const p = await pageProject({ createDirectory, execBytes, startService });
    const pageId = await p.importPage(script); await p.save([fullPage(pageId, p.duration)]);
    const submitted = await p.post('/api/visual-previews/submit', { segmentId: p.segmentId });
    let task: any;
    await expect.poll(async () => {
      task = (await fetch(p.service.url + '/api/visual-previews').then(r => r.json())).tasks.find((t: any) => t.id === submitted.id); return task?.state;
    }, { timeout: 140000 }).toBe('failed');
    expect(task.issues).toEqual(expect.arrayContaining([expect.objectContaining({ segmentId: p.segmentId, order: 1, message: expect.stringContaining(reason) })]));
    expect(task.output).toBeUndefined();
  }, 150000);
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
