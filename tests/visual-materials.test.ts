import { selectTestStyle } from './helpers/project-style.js';
import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { queryStatus } from '../src/shared/client.js';

test('原生透明图片通过业务入口导入并只加入指定片段，移出保留原件', async ({ createDirectory, execBytes, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-native-'));
  const sourcePath = join(root, 'ip.png');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red@0.5:s=32x32,format=rgba', '-frames:v', '1', sourcePath]);
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const post = async (path: string, input: unknown) => { const r = await fetch(service.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); expect(r.status).toBe(200); return r.json(); };
  const { asset } = await post('/api/codex/import-material', { sourcePath });
  expect(asset).toMatchObject({ kind: 'image', width: 32, height: 32, hasAlpha: true });
  await post('/api/codex/modify', { changes: [{ kind: 'add', text: '第一句' }, { kind: 'add', text: '第二句' }] });
  let snapshot = (await queryStatus(service.url)).snapshot;
  await post('/api/codex/modify', { changes: [{ kind: 'materials', expected: snapshot.segments[0], assetIds: [asset.id] }] });
  snapshot = (await queryStatus(service.url)).snapshot;
  expect(snapshot.segments[0]?.materials).toEqual([asset.id]);
  expect(snapshot.segments[1]?.materials ?? []).toEqual([]);
  const original = await fetch(`${service.url}/api/media/${asset.id}/original`);
  expect(original.headers.get('content-type')).toBe('image/png');
  expect((await original.arrayBuffer()).byteLength).toBeGreaterThan(50);
  const broken = join(root, 'broken.jpg');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=yellow:s=12x12', '-frames:v', '1', broken]);
  const damaged = (await post('/api/codex/import-material', { sourcePath: broken })).asset;
  expect(damaged).toMatchObject({ kind: 'image', mime: 'image/jpeg', hasAlpha: false });
  const { readFileSync, readdirSync } = await import('node:fs');
  // 模拟项目原件被外部损坏；按已导入内容定位夹具，不依赖数据库结构或媒体文件命名。
  const originalBytes = readFileSync(broken);
  const stored = readdirSync(snapshot.storage.mediaDirectory).map(name => join(snapshot.storage.mediaDirectory, name)).find(path => readFileSync(path).equals(originalBytes))!;
  writeFileSync(stored, '损坏原件');
  const rejected = await post('/api/codex/modify', { changes: [{ kind: 'materials', expected: snapshot.segments[0], assetIds: [damaged.id] }] });
  expect(rejected.summary.failed).toBe(1);
  expect((await queryStatus(service.url)).snapshot.segments[0]?.materials).toEqual([asset.id]);
  await post('/api/codex/modify', { changes: [{ kind: 'materials', expected: snapshot.segments[0], assetIds: [] }] });
  expect((await queryStatus(service.url)).snapshot.assets).toHaveLength(2);
});

test('MCP 保存编排并真实合成透明叠加，查询过期状态及重开恢复', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-compose-'));
  const background = join(root, 'background.mp4'); const ip = join(root, 'ip.png'); const badge = join(root, 'badge.png'); const audio = join(root, 'voice.mp3');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x48:d=0.6:r=25[blue];color=yellow:s=64x48:d=0.4:r=25[yellow];[blue][yellow]concat=n=2:v=1:a=0', '-c:v', 'libx264', background]);
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red@0.5:s=32x32,format=rgba,pad=64:32:0:0:color=black@0', '-frames:v', '1', ip]);
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=lime:s=32x32', '-frames:v', '1', badge]);
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'libmp3lame', audio]);
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(audio).toString('base64');
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: { configPath: '.env', key: () => 'test', fetch: (async () => new Response(`data: {"code":0,"data":"${bytes}"}\n\ndata: {"code":20000000}\n\n`)) as typeof fetch } };
  let service = await startService(options);
  const post = async (path: string, input: unknown) => { const r = await fetch(service.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); expect(r.status).toBe(200); return r.json(); };
  const assets = [];
  for (const sourcePath of [background, ip, badge]) assets.push((await post('/api/codex/import-material', { sourcePath })).asset);
  await post('/api/codex/modify', { changes: [{ kind: 'add', text: '组合画面' }] });
  let segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  await post('/api/codex/modify', { changes: [{ kind: 'video', expected: segment, assetId: assets[0].id, start: 0.1 }] });
  segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  expect(segment.materials).toEqual([assets[0].id]);
  expect(segment.composition).toBeUndefined();
  await post('/api/codex/modify', { changes: [{ kind: 'materials', expected: segment, assetIds: assets.map(asset => asset.id) }] });
  segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createBusinessMcp } = await import('../src/mcp/server.js');
  const mcp = openConnection(() => createBusinessMcp(service.url));
  const client = openConnection(() => new Client({ name: '编排测试', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  await post('/api/speech/submit', { requestId: crypto.randomUUID(), segmentId: segment.id });
  await expect.poll(async () => (await (await fetch(service.url + '/api/speech')).json()).locked).toBe(false);
  const context = await client.callTool({ name: 'clapgrid_visual_context', arguments: { segmentId: segment.id } });
  expect(context.isError).not.toBe(true);
  expect((context.structuredContent as any).duration).toBeCloseTo(1, 3);
  const plan = { duration: 1, layers: [
    { assetId: assets[0].id, role: 'background', from: 0, to: 1, start: 0, x: 0, y: 0, width: 1, height: 1, z: 0 },
    { assetId: assets[1].id, role: 'overlay', from: 0.2, to: 0.8, start: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.3, z: 1 },
    { assetId: assets[2].id, role: 'overlay', from: 0.4, to: 0.7, start: 0, x: 0.25, y: 0.2, width: 0.1, height: 0.1, z: 2 },
  ] };
  const saved = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'composition', expected: segment, plan }] } });
  expect(saved.isError).not.toBe(true);
  expect((saved.structuredContent as any).summary.applied).toBe(1);
  await selectTestStyle(service.url);
  await post('/api/codex/export-settings', { expected: (await queryStatus(service.url)).snapshot.exportSettings, settings: { codec: 'libx264', fps: 25 } });
  const submitted = await client.callTool({ name: 'clapgrid_preview_segment', arguments: { segmentId: segment.id } });
  expect(submitted.isError).not.toBe(true);
  const id = (submitted.structuredContent as any).id;
  let task: any;
  await expect.poll(async () => { task = (await (await fetch(service.url + '/api/visual-previews')).json()).tasks.find((t: any) => t.id === id); return task?.state; }, { timeout: 60000 }).toBe('succeeded');
  expect(task.current).toBe(true);
  expect((await (await fetch(service.url + '/api/exports')).json()).tasks).toEqual([]);
  const result = join(root, 'result.mp4'); writeFileSync(result, Buffer.from(await (await fetch(service.url + task.output.url)).arrayBuffer()));
  const pixel = async (time: number, x: number, y: number) => {
    const frame = await execBytes('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', result, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [...frame];
  };
  expect((await pixel(0.1, 300, 200))[2]).toBeGreaterThan(220);
  const blend = await pixel(0.3, 400, 200); expect(blend[0]).toBeGreaterThan(90); expect(blend[2]).toBeGreaterThan(90);
  expect((await pixel(0.5, 540, 260))[1]).toBeGreaterThan(220);
  expect((await pixel(0.3, 650, 200))[2]).toBeGreaterThan(220);
  expect((await pixel(0.9, 400, 200))[0]).toBeGreaterThan(220);
  expect((await pixel(0.9, 400, 200))[1]).toBeGreaterThan(220);
  const full = await post('/api/exports/submit', {});
  let fullTask: any;
  await expect.poll(async () => { fullTask = (await (await fetch(service.url + '/api/exports')).json()).tasks.find((t: any) => t.id === full.id); return fullTask?.state; }, { timeout: 60000 }).toBe('succeeded');
  const previewPixels = await pixel(0.5, 540, 260);
  writeFileSync(result, Buffer.from(await (await fetch(service.url + fullTask.output.url)).arrayBuffer()));
  expect(await pixel(0.5, 540, 260)).toEqual(previewPixels);
  segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  const uneven = { ...plan, layers: [
    { ...plan.layers[0]!, to: 0.25, start: 0.6 },
    { ...plan.layers[0]!, from: 0.25, start: 0 }, ...plan.layers.slice(1),
  ] };
  expect((await post('/api/codex/modify', { changes: [{ kind: 'composition', expected: segment, plan: uneven }] })).summary.applied).toBe(1);
  expect((await (await fetch(service.url + '/api/visual-previews')).json()).tasks[0].current).toBe(false);
  const changed = await post('/api/visual-previews/submit', { segmentId: segment.id });
  await expect.poll(async () => { task = (await (await fetch(service.url + '/api/visual-previews')).json()).tasks.find((t: any) => t.id === changed.id); return task?.state; }, { timeout: 60000 }).toBe('succeeded');
  writeFileSync(result, Buffer.from(await (await fetch(service.url + task.output.url)).arrayBuffer()));
  expect((await pixel(0.1, 960, 100))[0]).toBeGreaterThan(220);
  expect((await pixel(0.35, 960, 100))[2]).toBeGreaterThan(220);
  const cancelled = await post('/api/visual-previews/submit', { segmentId: segment.id });
  await post('/api/exports/cancel', { taskId: cancelled.id });
  await expect.poll(async () => (await (await fetch(service.url + '/api/visual-previews')).json()).tasks.find((t: any) => t.id === cancelled.id)?.state, { timeout: 60000 }).toBe('cancelled');
  segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  await post('/api/codex/modify', { changes: [{ kind: 'edit', expected: segment, visualNote: '角色向右移动' }] });
  expect((await (await fetch(service.url + '/api/visual-previews')).json()).tasks[0].current).toBe(false);
  const conflict = await post('/api/codex/modify', { changes: [{ kind: 'composition', expected: segment, plan }] });
  expect(conflict.summary.changed).toBe(1);
  const staleTask = await post('/api/visual-previews/submit', { segmentId: segment.id });
  await expect.poll(async () => (await (await fetch(service.url + '/api/visual-previews')).json()).tasks.find((t: any) => t.id === staleTask.id)?.state, { timeout: 60000 }).toBe('failed');
  await service.close(); service = await startService({ ...options, port: Number(new URL(service.url).port) });
  expect((await queryStatus(service.url)).snapshot.segments[0]?.composition?.layers).toHaveLength(4);
  expect((await queryStatus(service.url)).snapshot.assets).toHaveLength(3);
}, 60000);

test('拒绝打开旧格式项目，保留旧数据库和媒体原件', async ({ createDirectory }) => {
  const { startService } = await import('../src/service/server.js');
  const { cpSync, readdirSync, readFileSync } = await import('node:fs');
  const root = createDirectory(join(tmpdir(), 'clapgrid-legacy-read-'));
  const projectDirectory = join(root, 'project');
  cpSync(new URL('./fixtures/legacy-visuals', import.meta.url), projectDirectory, { recursive: true });
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const files = () => readdirSync(projectDirectory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name))]);
  const before = files();
  await expect(startService({ projectDirectory, panelDirectory, port: 0 })).rejects.toThrow('项目格式过旧，请新建项目');
  expect(files()).toEqual(before);
});
