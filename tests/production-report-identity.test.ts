import { test } from './helpers/resource-test.js';
import { vi } from 'vitest';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, linkSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

for (const kind of ['制作输入', '历史证明原件']) test(`真实入口拒绝报告硬链接别名并保留${kind}原字节`, async ({ command, createDirectory }) => {
  const project = createDirectory(join(tmpdir(), 'clapgrid-report-identity-'));
  const original = join(project, 'source.ts');
  const report = join(project, 'alias.json');
  const bytes = JSON.stringify({ schemaVersion: 1, report, startedAt: 'controlled-test', checks: [] });
  writeFileSync(original, bytes);
  linkSync(original, report);
  const manifest = kind === '制作输入'
    ? { schemaVersion: 1, segments: [{ id: 'A', source: 'source.ts' }] }
    : { schemaVersion: 1, evidence: 'evidence.json' };
  if (kind === '历史证明原件') writeFileSync(join(project, 'evidence.json'), JSON.stringify({ reviewVersion: 'current', records: [{ reviewVersion: 'old', provenance: { record: 'source.ts' } }] }));
  writeFileSync(join(project, 'production.json'), JSON.stringify(manifest));
  const result = (await command(process.execPath, [resolve('scripts/production.mjs'), 'refs', '--project', project, '--report', report], { encoding: 'utf8' }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(readFileSync(original, 'utf8'), bytes);
  assert.equal(readFileSync(report, 'utf8'), bytes);
  const location = result.stdout.match(/完整报告：(.*)/)?.[1];
  assert.ok(location, result.stdout + result.stderr);
  assert.notEqual(location, report);
  assert.match(readFileSync(location, 'utf8'), /报告路径属于项目输入或输出，拒绝覆盖/);
});

for (const kind of ['文件', '父目录']) test(`真实入口拒绝尚未生成原件的${kind}符号链接报告别名`, async ({ command, createDirectory }) => {
  const project = createDirectory(join(tmpdir(), 'clapgrid-report-dangling-'));
  const future = kind === '文件' ? 'future.txt' : 'future/result.json';
  const report = kind === '文件' ? join(project, 'alias.json') : join(project, 'alias', 'result.json');
  symlinkSync(kind === '文件' ? 'future.txt' : 'future', kind === '文件' ? report : join(project, 'alias'), kind === '文件' ? 'file' : 'dir');
  writeFileSync(join(project, 'evidence.json'), JSON.stringify({ requirements: [{ required: [{ artifact: future }] }] }));
  writeFileSync(join(project, 'production.json'), JSON.stringify({ schemaVersion: 1, evidence: 'evidence.json' }));
  const result = (await command(process.execPath, [resolve('scripts/production.mjs'), 'refs', '--project', project, '--report', report], { encoding: 'utf8' }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(existsSync(join(project, future)), false);
  if (kind === '父目录') assert.equal(existsSync(join(project, 'future')), false);
  const location = result.stdout.match(/完整报告：(.*)/)?.[1];
  assert.ok(location, result.stdout + result.stderr);
  assert.notEqual(location, report);
  assert.match(readFileSync(location, 'utf8'), /报告路径属于项目输入或输出，拒绝覆盖/);
});
