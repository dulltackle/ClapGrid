import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';

test('风格通过 HTTP 导入得到稳定身份，源文件变化产生新身份且项目副本独立', async ({ createDirectory, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-style-'));
  const sourceDirectory = join(root, 'style'); cpSync(resolve('tests/fixtures/style'), sourceDirectory, { recursive: true });
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const post = async () => {
    const r = await fetch(service.url + '/api/codex/import-style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory }) });
    expect(r.status, await r.clone().text()).toBe(200); return (await r.json()).style;
  };
  const description = readFileSync(join(sourceDirectory, 'STYLE.md'), 'utf8');
  for (const heading of ['本质与“它不是什么”', '材质与渲染', '配色逻辑', '字体与字幕', '运动质感', '镜头语法', '转场', '修改分级']) expect(description).toContain(`## ${heading}`);
  const first = await post(); expect(first.styleId).toMatch(/^[a-f0-9]{64}$/);
  expect(await post()).toEqual(first);
  writeFileSync(join(sourceDirectory, 'lib/color.js'), `export const color=t=>'blue';`);
  expect((await post()).styleId).not.toBe(first.styleId);
});

for (const scenario of ['symlink', 'hardlink', 'extension', 'files', 'bytes', 'outside', 'ancestor', 'missing-style', 'missing-lib', 'missing-example', 'missing-subtitle'] as const) {
  test(`风格导入拒绝不安全、超限或不完整目录：${scenario}`, async ({ createDirectory, startService }) => {
    const { symlinkSync, linkSync, truncateSync, rmSync, readdirSync, existsSync } = await import('node:fs');
    const root = createDirectory(join(tmpdir(), 'clapgrid-style-boundary-'));
    const outside = createDirectory(join(tmpdir(), 'clapgrid-style-outside-'));
    const source = join(root, 'style'); cpSync(resolve('tests/fixtures/style'), source, { recursive: true });
    let sourceDirectory = source;
    if (scenario === 'symlink') symlinkSync(join(source, 'STYLE.md'), join(source, 'link.md'));
    if (scenario === 'hardlink') linkSync(join(source, 'STYLE.md'), join(source, 'link.md'));
    if (scenario === 'extension') writeFileSync(join(source, 'secret.env'), 'secret');
    if (scenario === 'files') for (let i = 0; i < 256; i++) writeFileSync(join(source, `${i}.js`), '');
    if (scenario === 'bytes') { writeFileSync(join(source, 'large.png'), ''); truncateSync(join(source, 'large.png'), 32 * 1024 * 1024); }
    if (scenario === 'outside') { cpSync(source, join(outside, 'style'), { recursive: true }); sourceDirectory = join(outside, 'style'); }
    if (scenario === 'ancestor') { symlinkSync(source, join(root, 'alias')); sourceDirectory = join(root, 'alias'); }
    if (scenario === 'missing-style') rmSync(join(source, 'STYLE.md'));
    if (scenario === 'missing-lib') rmSync(join(source, 'lib'), { recursive: true });
    if (scenario === 'missing-subtitle') rmSync(join(source, 'lib/subtitle.js'));
    if (scenario === 'missing-example') rmSync(join(source, 'example'), { recursive: true });
    const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
    const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
    const response = await fetch(service.url + '/api/codex/import-style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/链接|类型|上限|工作空间|STYLE.md|subtitle.js/);
    const styles = join(root, 'project', 'styles'); expect(existsSync(styles) ? readdirSync(styles) : []).toEqual([]);
  });
}

test('MCP 风格导入返回稳定身份，可设置和清空项目风格，页面拒绝旧风格声明', async ({ createDirectory, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-style-mcp-'));
  const sourceDirectory = join(root, 'style'); cpSync(resolve('tests/fixtures/style'), sourceDirectory, { recursive: true });
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createBusinessMcp } = await import('../src/mcp/server.js');
  const server = openConnection(() => createBusinessMcp(service.url));
  const client = openConnection(() => new Client({ name: '风格测试', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const imported = await client.callTool({ name: 'clapgrid_import_style', arguments: { sourceDirectory } });
  expect(imported.isError).not.toBe(true); const style = (imported.structuredContent as any).style;
  expect(style.styleId).toMatch(/^[a-f0-9]{64}$/);
  const repeated = await client.callTool({ name: 'clapgrid_import_style', arguments: { sourceDirectory } });
  expect((repeated.structuredContent as any).style).toEqual(style);
  const set = (expected: string | null, styleId: string | null) => client.callTool({
    name: 'clapgrid_set_project_style', arguments: { expected, styleId },
  });
  expect((await set(null, 'a'.repeat(64))).isError).toBe(true);
  const { beginEdit } = await import('../src/shared/client.js');
  const editing = await beginEdit(service.url);
  try {
    const blocked = await set(null, style.styleId);
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked.content)).toContain('用户正在编辑');
  } finally { await editing.close(); }
  const selected = await set(null, style.styleId);
  expect(selected.isError, JSON.stringify(selected)).not.toBe(true);
  expect((selected.structuredContent as any).status.snapshot.projectStyle).toEqual({
    styleId: style.styleId, id: 'test-color', version: '1', source: null,
  });
  expect((await set(null, null)).isError).toBe(true);
  const cleared = await set(style.styleId, null);
  expect((cleared.structuredContent as any).status.snapshot.projectStyle).toBeNull();
  const importedModule = join(root, 'project', 'styles', style.styleId, 'lib/color.js');
  chmodSync(importedModule, 0o644);
  writeFileSync(importedModule, 'export const color = () => "orange";');
  const tampered = await set(null, style.styleId);
  expect(tampered.isError).toBe(true);
  expect(JSON.stringify(tampered.content)).toContain('副本已改变');
  const pageDirectory = join(root, 'page'); mkdirSync(pageDirectory); writeFileSync(join(pageDirectory, 'index.html'), 'page');
  for (const [metadata, status] of [[{ style: 'a'.repeat(64) }, 400], [{ style: '../style' }, 400], [{}, 200], [{ style: style.styleId, extra: true }, 400], [{ style: style.styleId }, 400]] as const) {
    writeFileSync(join(pageDirectory, 'page.json'), JSON.stringify(metadata));
    const response = await fetch(service.url + '/api/codex/import-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory: pageDirectory }) });
    expect(response.status, await response.clone().text()).toBe(status);
  }
});

const needsCases = [
  ['needs: [image-generation]', true],
  ['needs: ["image-generation"]', true],
  ["needs: ['image-generation']", true],
  ['needs: []', true],
  ['needs: [webgl]', false],
  ['needs: [image-generation, image-generation]', false],
  ['needs:\n  - image-generation', false],
  ['needs: image-generation', false],
  ['needs: [image-generation', false],
  ['needs: [image-generation, ]', false],
] as const;
for (const [declaration, accepted] of needsCases) {
  test(`风格导入校验 needs 声明：${declaration.replace('\n', '⏎')}`, async ({ createDirectory, startService }) => {
    const { readdirSync, existsSync } = await import('node:fs');
    const root = createDirectory(join(tmpdir(), 'clapgrid-style-needs-'));
    const sourceDirectory = join(root, 'style'); cpSync(resolve('tests/fixtures/style'), sourceDirectory, { recursive: true });
    const stylePath = join(sourceDirectory, 'STYLE.md');
    writeFileSync(stylePath, readFileSync(stylePath, 'utf8').replace(/^version:.*$/m, match => `${match}\n${declaration}`));
    const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
    const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
    const response = await fetch(service.url + '/api/codex/import-style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory }) });
    const styles = join(root, 'project', 'styles');
    if (!accepted) {
      expect(response.status).toBe(400);
      const { error } = await response.json();
      expect(error).toContain('needs');
      expect(error).toContain('image-generation');
      expect(error).toContain('needs: [image-generation]');
      if (declaration.includes('webgl')) expect(error).toContain('不支持的取值：webgl');
      if (declaration.includes('generation, image')) expect(error).toContain('重复');
      expect(existsSync(styles) ? readdirSync(styles) : []).toEqual([]);
      return;
    }
    expect(response.status, await response.clone().text()).toBe(200);
    const { style } = await response.json();
    expect(readFileSync(join(styles, style.styleId, 'STYLE.md'), 'utf8')).toContain(declaration);
  });
}
