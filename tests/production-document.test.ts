import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const initUrl = new URL('../scripts/production/init.mjs', import.meta.url).href;

test('两个隔离项目获得独立约定，重新初始化保留各自修改', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-production-doc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, '项目 A');
  const b = join(root, '项目 B');
  await Promise.all([mkdir(a), mkdir(b)]);
  const { default: init } = await import(initUrl);
  assert.equal((await init({ project: a })).status, 'passed');
  assert.equal((await init({ project: b })).status, 'passed');
  const original = await readFile(join(b, 'video.md'), 'utf8');
  await writeFile(join(a, 'video.md'), `${original}\nA：突出透明材质。\n`);
  await writeFile(join(b, 'video.md'), `${original}\nB：使用简洁线图。\n`);
  await init({ project: a });
  await init({ project: b });
  assert.equal(await readFile(join(a, 'video.md'), 'utf8'), `${original}\nA：突出透明材质。\n`);
  assert.equal(await readFile(join(b, 'video.md'), 'utf8'), `${original}\nB：使用简洁线图。\n`);
});

test('模板升级只用于新项目，已有项目副本保持不变', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-template-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = join(root, 'kit');
  await mkdir(join(kit, 'scripts', 'production'), { recursive: true });
  await mkdir(join(kit, 'docs', 'templates'), { recursive: true });
  await cp(new URL(initUrl), join(kit, 'scripts', 'production', 'init.mjs'));
  const template = join(kit, 'docs', 'templates', 'video.md');
  await writeFile(template, '模板来源：测试版 1\n');
  const a = join(root, 'old');
  const b = join(root, 'new');
  await Promise.all([mkdir(a), mkdir(b)]);
  const { default: init } = await import(pathToFileURL(join(kit, 'scripts', 'production', 'init.mjs')).href);
  await init({ project: a });
  await writeFile(template, '模板来源：测试版 2\n');
  await init({ project: a });
  await init({ project: b });
  assert.equal(await readFile(join(a, 'video.md'), 'utf8'), '模板来源：测试版 1\n');
  assert.equal(await readFile(join(b, 'video.md'), 'utf8'), '模板来源：测试版 2\n');
});

test('引用检查解析图片与动态样片的本地和 HTTP 地址，明确定位无效引用', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '素材'));
  await writeFile(join(root, '素材', '参考 图.png'), 'local image');
  await writeFile(join(root, '样片 (初版).mp4'), 'local sample');
  const document = [
    '![参考](<素材/参考 图.png>)',
    `[动态样片](<${join(root, '样片 (初版).mp4')}>)`,
    '[方法](https://github.com/dulltackle/ClapGrid/issues/102)',
    '[缺图](素材/missing.png)',
    '[无效远端](https://)',
  ].join('\n');
  await writeFile(join(root, 'video.md'), document);
  const { default: refs } = await import(new URL('../scripts/production/refs.mjs', import.meta.url).href);
  const report = await refs({ project: root });
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.filter((c: { status: string }) => c.status === 'passed').length, 3);
  const failures = report.checks.filter((c: { status: string }) => c.status === 'failed');
  assert.equal(failures.length, 2);
  assert.equal(failures[0].line, 4);
  assert.match(failures[0].message, /不存在/);
  assert.equal(failures[1].line, 5);
  assert.match(failures[1].message, /HTTP.*无效/);
  assert.equal(await readFile(join(root, 'video.md'), 'utf8'), document);
});

test('引用式样片和图片可解析，未定义引用明确失败，代码示例无需真实文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-reference-style-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '参考.png'), 'image');
  await writeFile(join(root, '样片.mp4'), 'video');
  await writeFile(join(root, 'video.md'), [
    '![参考][image]', '[动态样片][clip]', '[坏样片][unknown]',
    '[image]: 参考.png', '[clip]: 样片.mp4',
    '`![代码示例](不存在.png)`', '```md', '[示例](missing.mp4)', '```',
  ].join('\n'));
  const { default: refs } = await import(new URL('../scripts/production/refs.mjs', import.meta.url).href);
  const report = await refs({ project: root });
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.filter((c: { status: string }) => c.status === 'passed').length, 2);
  const failures = report.checks.filter((c: { status: string }) => c.status === 'failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].line, 3);
  assert.match(failures[0].message, /未定义.*unknown/);
});

test('快捷引用与嵌套说明中的缺失素材不会被误报通过', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-reference-shortcut-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'video.md'), [
    '![参考图片]', '[动态样片]', '[样片[初版]](missing-nested.mp4)',
    '[参考图片]: missing.png', '[动态样片]: missing.mp4',
  ].join('\n'));
  const { default: refs } = await import(new URL('../scripts/production/refs.mjs', import.meta.url).href);
  const report = await refs({ project: root });
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.length, 3);
  assert.deepEqual(report.checks.map((c: { line: number }) => c.line), [1, 2, 3]);
  for (const check of report.checks) {
    assert.equal(check.status, 'failed');
    assert.match(check.message, /不存在/);
  }
});
