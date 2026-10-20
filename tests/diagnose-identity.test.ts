import { projectCleanup } from './helpers/project-cleanup.js';
import { execText } from './helpers/vitest-command.js';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';


const command = resolve('scripts/diagnose-identity.mjs');
test('汇总命令缺少身份与宿主证据时保留未知，服务不可达且不创建文件', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-diagnose-'));
  projectCleanup(t).directory(root);
  writeFileSync(join(root, 'credentials.json'), 'secret-provider-value');
  const before = readdirSync(root);
  const output = (await execText(process.execPath, [command, '--build', root, '--installed', root,
    '--workspace', root, '--service-url', 'http://127.0.0.1:1'], { encoding: 'utf8', cwd: root }));
  const report = JSON.parse(output);
  assert.equal(report.build.status, 'unknown');
  assert.equal(report.installed.status, 'unknown');
  assert.equal(report.mcp.status, 'unknown');
  assert.equal(report.service.status, 'unreachable');
  assert.equal(output.includes('secret-provider-value'), false);
  assert.deepEqual(readdirSync(root), before);
});

test('宿主证据明确记录不可达、过期和来源，不泄露额外字段', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-evidence-'));
  projectCleanup(t).directory(root);
  const file = join(root, 'evidence.json');
  const run = async (evidence: unknown) => {
    writeFileSync(file, JSON.stringify(evidence));
    const output = (await execText(process.execPath, [command, '--build', root, '--mcp-evidence', file], { encoding: 'utf8' }));
    assert.equal(output.includes('private-token'), false);
    return JSON.parse(output);
  };
  const current = { source: 'actual-host', observedAt: new Date().toISOString(), status: 'unreachable', secret: 'private-token' };
  assert.equal((await run(current)).mcp.status, 'unreachable');
  const stale = (await run({ ...current, observedAt: '2000-01-01T00:00:00Z' }));
  assert.equal(stale.mcp.status, 'unknown');
  assert.equal(stale.mcp.source, 'actual-host');
  assert.equal(stale.mcp.observedAt, '2000-01-01T00:00:00.000Z');
  assert.equal((await run({ ...current, source: 'new-process' })).mcp.status, 'unknown');
  assert.equal((await run({ ...current, status: 'reachable', response: { version: '0.1.0', directory: root } })).mcp.status, 'unknown');
});

test('交付验收入口缺实际宿主和面板证据时返回非成功退出码', async () => {
  await assert.rejects(() => execText(process.execPath, [command, '--require-current', '--build', '/不存在的插件构建'], { encoding: 'utf8' }), (error: any) => {
    assert.equal(error.status, 2);
    const report = JSON.parse(error.stdout);
    assert.equal(report.complete, false);
    assert.equal(report.panel.status, 'unknown');
    return true;
  });
});
