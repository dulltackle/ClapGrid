import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli = resolve('scripts/agent-tools.mjs');
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
test('CLI 核对候选解释器并解析已知技能软链接', () => {
  const missing = run('interpreter', 'clapgrid-missing-interpreter');
  assert.notEqual(missing.status, 0);
  const found = run('interpreter', 'clapgrid-missing-interpreter', process.execPath);
  assert.equal(found.status, 0);
  assert.equal(JSON.parse(found.stdout).selected, process.execPath);
  const dir = mkdtempSync(join(tmpdir(), 'agent-tools-'));
  writeFileSync(join(dir, 'SKILL.md'), '技能正文');
  symlinkSync(join(dir, 'SKILL.md'), join(dir, 'link.md'));
  assert.equal(JSON.parse(run('skill', join(dir, 'link.md')).stdout).path, join(dir, 'SKILL.md'));
});
test('GitHub CLI 汇总全部分页、投影字段并保留可追溯副本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-github-'));
  const fixture = resolve('tests/fixtures/agent-tools/pages.json');
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\n[ "$1" = api ] && [ "$3" = --method ] && [ "$4" = GET ] && [ "$5" = --paginate ] && [ "$6" = --slurp ] || exit 3\ncat '${fixture}'\n`, { mode: 0o700 });
  const evidence = join(dir, 'result.json');
  const result = spawnSync(process.execPath, [cli, 'github', 'repos/dulltackle/ClapGrid/issues?per_page=1', 'number,title', evidence], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.pages, 2);
  assert.equal(summary.count, 2);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.items.map((item: { number: number }) => item.number), [50, 56]);
  const read = run('read', evidence, '1', '100');
  assert.equal(read.status, 0);
  assert.match(read.stdout, /最后一页事项/);
  assert.doesNotMatch(read.stdout, /fixture-secret|完整正文/);
});
test('长结果先脱敏留存，摘要不暴露密钥且按需读取末项', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-capture-'));
  const path = join(dir, 'output.json');
  const input = JSON.stringify({ password: 'plain-secret', note: 'Bearer hidden-auth ghp_fixedtoken', rows: Array.from({ length: 30 }, (_, n) => ({ number: n + 1 })) });
  const result = spawnSync(process.execPath, [cli, 'capture', path], { encoding: 'utf8', input });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /plain-secret|hidden-auth|fixedtoken/);
  const read = run('read', path, '1', '200');
  assert.doesNotMatch(read.stdout, /plain-secret|hidden-auth|fixedtoken/);
  assert.match(read.stdout, /REDACTED/);
  assert.match(read.stdout, /30/);
  assert.notEqual(spawnSync(process.execPath, [cli, 'capture', path], { encoding: 'utf8', input }).status, 0, '已有证据不可覆盖');
});
test('失败与不支持的分页响应不能产生完整证据', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-failure-'));
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\nprintf \'[{"items":[],"incomplete_results":true}]\'\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, [cli, 'github', 'repos/dulltackle/ClapGrid/issues', 'number', join(dir, 'bad.json')], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.notEqual(run('github', 'repos/dulltackle/ClapGrid/issues?page=2', 'number', join(dir, 'skip.json')).status, 0);
});

test('已知纯文本凭据、完整认证值及环境秘密在留存和读取两个出口均脱敏', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-secrets-'));
  const path = join(dir, 'text.json');
  const env = { ...process.env, AGENT_TEST_SECRET: 'known-environment-value', AGENT_SHORT_SECRET: 'z9x' };
  const input = `credential=fixture-credential
Authorization: Basic Zml4dHVyZTpwYXNzd29yZA==
client.credentials="fixture with spaces"
X-Api-Key: other-fixture-key
known-environment-value
z9x
`;
  const capture = spawnSync(process.execPath, [cli, 'capture', path], { encoding: 'utf8', input, env });
  assert.equal(capture.status, 0);
  const read = spawnSync(process.execPath, [cli, 'read', path, '1', '200'], { encoding: 'utf8', env });
  assert.equal(read.status, 0);
  const secrets = /fixture-credential|Zml4dHVyZTpwYXNzd29yZA==|fixture with spaces|other-fixture-key|known-environment-value|z9x/;
  assert.doesNotMatch(readFileSync(path, 'utf8'), secrets);
  assert.doesNotMatch(capture.stdout + read.stdout, secrets);
  const structured = join(dir, 'structured.json');
  const jsonInput = JSON.stringify({ nested: [{ 'client.credentials': { user: 'nested-secret' }, 'x-api-key': ['array-secret'] }], safe: 'kept' });
  assert.equal(spawnSync(process.execPath, [cli, 'capture', structured], { encoding: 'utf8', input: jsonInput }).status, 0);
  assert.doesNotMatch(readFileSync(structured, 'utf8') + run('read', structured, '1', '200').stdout, /nested-secret|array-secret/);
  assert.match(run('read', structured).stdout, /kept/);
  // 读取旧的未脱敏证据也必须保护显示出口。
  writeFileSync(join(dir, 'old.txt'), input);
  const legacy = spawnSync(process.execPath, [cli, 'read', join(dir, 'old.txt')], { encoding: 'utf8', env });
  assert.doesNotMatch(legacy.stdout, secrets);
});
test('超长单行及多行 Unicode 文本按字节预算输出并可无损续读到末尾', () => {
  for (const input of ['line=' + 'a'.repeat(200000) + '\nlast-line', ('多行🙂\t"内容\n').repeat(5000) + '最终行']) {
    const dir = mkdtempSync(join(tmpdir(), 'agent-budget-'));
    const path = join(dir, 'long.json');
    assert.equal(spawnSync(process.execPath, [cli, 'capture', path, 'complete'], { encoding: 'utf8', input }).status, 0);
    const first = run('read', path, '4', '1');
    assert.equal(first.status, 0);
    assert.ok(Buffer.byteLength(first.stdout) <= 8192, '整条 stdout 遵守默认字节预算');
    assert.equal(JSON.parse(first.stdout).truncated, true);
    assert.ok(JSON.parse(first.stdout).next, '超长行具有后续起点');
    let next: { line: number; offset: number } | null = { line: 1, offset: 0 };
    let reconstructed = '';
    let calls = 0;
    while (next) {
      assert.ok(++calls < 200, '续读持续向前');
      const result = run('read', path, String(next.line), '200', String(next.offset), '8192');
      assert.equal(result.status, 0);
      assert.ok(Buffer.byteLength(result.stdout) <= 8192);
      const chunk = JSON.parse(result.stdout);
      assert.equal(chunk.byteBudget, 8192);
      assert.equal(chunk.truncated, calls > 1 || chunk.next !== null);
      reconstructed += chunk.text;
      next = chunk.next;
    }
    assert.ok(calls > 1);
    assert.equal(JSON.parse(reconstructed).value, input);
    assert.equal(JSON.parse(reconstructed).completeness, 'complete');
  }
});
test('HTTP 敏感头整体值脱敏且保留换行及安全日志行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-headers-'));
  const path = join(dir, 'headers.json');
  const input = [
    'Cookie: theme=dark; sid=review-cookie-session; auth=review-cookie-auth',
    '[debug 12:00] Set-Cookie: sid=review-set-session; Secure; HttpOnly; extra=review-extra-cookie',
    '[request] Authorization: Digest username="review-digest-user", nonce="review-digest-nonce"',
    '2026-10-05 INFO Proxy-Authorization: Custom review-proxy-first; param=review-proxy-last',
    'safe-line=retained',
    '',
  ].join('\r\n');
  assert.equal(spawnSync(process.execPath, [cli, 'capture', path], { encoding: 'utf8', input }).status, 0);
  const secrets = /review-(?:cookie|set|extra|digest|proxy)-[\w-]+/;
  const saved = readFileSync(path, 'utf8');
  assert.doesNotMatch(saved, secrets);
  const value = JSON.parse(saved).value;
  assert.equal(value.split('\r\n').length, 6);
  assert.match(value, /safe-line=retained/);
  assert.match(value, /\[debug 12:00\] Set-Cookie: \[REDACTED\]/);
  assert.doesNotMatch(run('read', path).stdout, secrets);
  const legacy = join(dir, 'headers.txt');
  writeFileSync(legacy, input);
  const read = run('read', legacy);
  assert.equal(read.status, 0);
  assert.doesNotMatch(read.stdout, secrets);
  assert.match(JSON.parse(read.stdout).text, /safe-line=retained/);
});
