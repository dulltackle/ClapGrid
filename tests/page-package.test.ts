import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dependencyView } from './helpers/temporary-repository.js';
import { fullPage, pageProject } from './helpers/page-project.js';

test('正式插件包包含全部内置风格并通过服务入口生成风格页面片段预览', async ({ createDirectory, execBytes, execCommand, startService, command }) => {
  const repo = resolve('.');
  const build = createDirectory(join(tmpdir(), 'clapgrid-page-package-'));
  for (const name of ['src', 'plugins', 'package.json', 'package-lock.json']) {
    cpSync(join(repo, name), join(build, name), { recursive: true });
  }
  cpSync(join(repo, 'tests/fixtures/style'), join(build, 'plugins/clapgrid/styles/test-color'), { recursive: true });
  dependencyView(build, join(repo, 'node_modules'));
  mkdirSync(join(build, 'dist/panel'), { recursive: true });
  writeFileSync(join(build, 'dist/panel/index.html'), 'panel');
  await execCommand(process.execPath, [join(repo, 'scripts/build-plugin.mjs')], { cwd: build });
  const p = await pageProject({ createDirectory, execBytes, startService });
  const builtStyles = join(build, 'dist/plugin/clapgrid/styles');
  const sourceStyles = join(build, 'plugins/clapgrid/styles');
  for (const file of readdirSync(sourceStyles, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())) {
    const path = join(file.parentPath, file.name).slice(sourceStyles.length + 1);
    expect(readFileSync(join(builtStyles, path))).toEqual(readFileSync(join(sourceStyles, path)));
  }
  const sourceDirectory = join(p.root, 'style'); cpSync(join(builtStyles, 'test-color'), sourceDirectory, { recursive: true });
  const styleId = (await p.post('/api/codex/import-style', { sourceDirectory })).style.styleId;
  const pageDirectory = join(p.root, 'page'); mkdirSync(pageDirectory);
  writeFileSync(join(pageDirectory, 'page.json'), JSON.stringify({ style: styleId }));
  writeFileSync(join(pageDirectory, 'index.html'), `<script type="module">import {color} from '/styles/${styleId}/lib/color.js';window.DUR=${p.duration};window.render=t=>{document.body.style.background=color(0.7)};window.READY=true</script>`);
  const pageId = (await p.post('/api/codex/import-page', { sourceDirectory: pageDirectory })).page.pageId;
  await p.save([fullPage(pageId, p.duration)]);
  await p.service.close();
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const run = command(process.execPath, [join(build, 'dist/plugin/clapgrid/dist/service/main.js'), '--project', p.options.projectDirectory, '--port', String(port)], { timeout: 60000 });
  let output = '';
  run.child.stdout!.on('data', chunk => { output += chunk; });
  try {
    await expect.poll(() => { try { return JSON.parse(output).url; } catch { return undefined; } }, { timeout: 15000 }).toBeTruthy();
    const url = JSON.parse(output).url;
    const accepted = await fetch(url + '/api/visual-previews/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segmentId: p.segmentId }),
    }).then(r => r.json());
    let task: any;
    await expect.poll(async () => {
      task = (await fetch(url + '/api/visual-previews').then(r => r.json())).tasks.find((t: any) => t.id === accepted.id);
      return task && ['succeeded', 'failed'].includes(task.state);
    }, { timeout: 45000 }).toBe(true);
    expect(task, JSON.stringify(task)).toMatchObject({ state: 'succeeded', current: true });
    const file = join(p.root, 'packaged.mp4');
    writeFileSync(file, Buffer.from(await (await fetch(url + task.output.url)).arrayBuffer()));
    const pixel = await execBytes('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:100:100,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    expect(pixel[1]).toBeGreaterThan(220);
  } finally { run.child.kill('SIGTERM'); await run; }
}, 60000);
