import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';

test('页面通过 HTTP 导入得到内容身份，重复导入幂等且修改源页面产生新身份', async ({ createDirectory, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-pages-'));
  const sourceDirectory = join(root, 'page'); mkdirSync(sourceDirectory);
  writeFileSync(join(sourceDirectory, 'index.html'), '<script>window.DUR=1;window.render=t=>{};window.READY=true</script>');
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const post = async () => {
    const r = await fetch(service.url + '/api/codex/import-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory }) });
    expect(r.status).toBe(200); return r.json();
  };
  const first = await post(); expect(first.page.pageId).toMatch(/^[a-f0-9]{64}$/);
  expect((await post()).page).toEqual(first.page);
  writeFileSync(join(sourceDirectory, 'index.html'), '<script>window.DUR=2;window.render=t=>Math.random();window.READY=true</script>');
  const changed = (await post()).page;
  expect(changed.pageId).not.toBe(first.page.pageId);
  expect(changed.warnings).toEqual([expect.stringContaining('Math.random')]);
});

for (const scenario of ['symlink', 'hardlink', 'extension', 'files', 'bytes', 'outside', 'ancestor', 'missing-index'] as const) {
  test(`页面导入拒绝不安全或超限目录：${scenario}`, async ({ createDirectory, startService }) => {
    const { symlinkSync, linkSync, truncateSync } = await import('node:fs');
    const root = createDirectory(join(tmpdir(), 'clapgrid-page-boundary-'));
    const outside = createDirectory(join(tmpdir(), 'clapgrid-page-outside-'));
    const source = join(root, 'page'); mkdirSync(source); writeFileSync(join(source, 'index.html'), 'page');
    let sourceDirectory = source;
    if (scenario === 'symlink') symlinkSync(join(source, 'index.html'), join(source, 'link.html'));
    if (scenario === 'hardlink') linkSync(join(source, 'index.html'), join(source, 'link.html'));
    if (scenario === 'extension') writeFileSync(join(source, 'secret.env'), 'secret');
    if (scenario === 'files') for (let i = 0; i < 256; i++) writeFileSync(join(source, `${i}.js`), '');
    if (scenario === 'bytes') { writeFileSync(join(source, 'large.png'), ''); truncateSync(join(source, 'large.png'), 32 * 1024 * 1024); }
    if (scenario === 'outside') { writeFileSync(join(outside, 'index.html'), 'page'); sourceDirectory = outside; }
    if (scenario === 'ancestor') { symlinkSync(source, join(root, 'alias')); sourceDirectory = join(root, 'alias'); }
    if (scenario === 'missing-index') { const { unlinkSync } = await import('node:fs'); unlinkSync(join(source, 'index.html')); }
    const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
    const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
    const response = await fetch(service.url + '/api/codex/import-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceDirectory }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/链接|类型|上限|工作空间|index.html/);
    const { existsSync, readdirSync } = await import('node:fs');
    const pages = join(root, 'project', 'pages'); expect(existsSync(pages) ? readdirSync(pages) : []).toEqual([]);
  });
}

test('MCP 页面导入返回稳定身份，编排拒绝不存在的页面', async ({ createDirectory, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-page-mcp-'));
  const sourceDirectory = join(root, 'page'); mkdirSync(sourceDirectory); writeFileSync(join(sourceDirectory, 'index.html'), 'page');
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createBusinessMcp } = await import('../src/mcp/server.js');
  const server = openConnection(() => createBusinessMcp(service.url));
  const client = openConnection(() => new Client({ name: '页面测试', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const imported = await client.callTool({ name: 'clapgrid_import_page', arguments: { sourceDirectory } });
  expect(imported.isError).not.toBe(true); expect((imported.structuredContent as any).page.pageId).toMatch(/^[a-f0-9]{64}$/);
  const repeated = await client.callTool({ name: 'clapgrid_import_page', arguments: { sourceDirectory } });
  expect((repeated.structuredContent as any).page).toEqual((imported.structuredContent as any).page);
  const post = async (changes: unknown[]) => (await fetch(service.url + '/api/codex/modify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) })).json();
  await post([{ kind: 'add', text: '页面' }]);
  let segment = (await (await fetch(service.url + '/api/status')).json()).snapshot.segments[0];
  await post([{ kind: 'materials', expected: segment, assetIds: [] }]);
  segment = (await (await fetch(service.url + '/api/status')).json()).snapshot.segments[0];
  const result = await post([{ kind: 'composition', expected: segment, plan: { duration: 1, layers: [{ kind: 'page', pageId: 'a'.repeat(64), assetIds: [], role: 'background', from: 0, to: 1, x: 0, y: 0, width: 1, height: 1, z: 0 }] } }]);
  expect(result.summary.failed).toBe(1); expect(result.results[0].message).toMatch(/页面不存在/);
});
