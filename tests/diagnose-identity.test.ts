import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const command = resolve('scripts/diagnose-identity.mjs');
test('汇总命令缺少身份与宿主证据时保留未知，服务不可达且不创建文件', t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-diagnose-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'credentials.json'), 'secret-provider-value');
  const before = readdirSync(root);
  const output = execFileSync(process.execPath, [command, '--build', root, '--installed', root,
    '--workspace', root, '--service-url', 'http://127.0.0.1:1'], { encoding: 'utf8', cwd: root });
  const report = JSON.parse(output);
  assert.equal(report.build.status, 'unknown');
  assert.equal(report.installed.status, 'unknown');
  assert.equal(report.mcp.status, 'unknown');
  assert.equal(report.service.status, 'unreachable');
  assert.equal(output.includes('secret-provider-value'), false);
  assert.deepEqual(readdirSync(root), before);
});

test('宿主证据明确记录不可达、过期和来源，不泄露额外字段', t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'evidence.json');
  const run = (evidence: unknown) => {
    writeFileSync(file, JSON.stringify(evidence));
    const output = execFileSync(process.execPath, [command, '--build', root, '--mcp-evidence', file], { encoding: 'utf8' });
    assert.equal(output.includes('private-token'), false);
    return JSON.parse(output);
  };
  const current = { source: 'actual-host', observedAt: new Date().toISOString(), status: 'unreachable', secret: 'private-token' };
  assert.equal(run(current).mcp.status, 'unreachable');
  const stale = run({ ...current, observedAt: '2000-01-01T00:00:00Z' });
  assert.equal(stale.mcp.status, 'unknown');
  assert.equal(stale.mcp.source, 'actual-host');
  assert.equal(stale.mcp.observedAt, '2000-01-01T00:00:00.000Z');
  assert.equal(run({ ...current, source: 'new-process' }).mcp.status, 'unknown');
  assert.equal(run({ ...current, status: 'reachable', response: { version: '0.1.0', directory: root } }).mcp.status, 'unknown');
});

test('交付验收入口缺实际宿主和面板证据时返回非成功退出码', () => {
  assert.throws(() => execFileSync(process.execPath, [command, '--require-current', '--build', '/不存在的插件构建'], { encoding: 'utf8' }), (error: any) => {
    assert.equal(error.status, 2);
    const report = JSON.parse(error.stdout);
    assert.equal(report.complete, false);
    assert.equal(report.panel.status, 'unknown');
    return true;
  });
});
