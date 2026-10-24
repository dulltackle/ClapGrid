import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function run(options: { failure?: string; alwaysFail?: boolean; installFail?: boolean; downloadOnly?: boolean; timeout?: boolean; logFail?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-system-packages-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const mirror = join(root, 'mirrors');
  writeFileSync(mirror, 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n');
  const calls = join(root, 'calls');
  const summary = join(root, 'summary');
  writeFileSync(summary, '');
  writeFileSync(join(bin, 'sudo'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
  if (options.logFail) writeFileSync(join(bin, 'tee'), '#!/bin/bash\ncat\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(bin, 'apt-get'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_CALLS"
if [[ " $* " == *' update '* ]]; then
  n=0; [[ ! -f "$TEST_COUNT" ]] || n=$(cat "$TEST_COUNT")
  n=$((n+1)); echo "$n" > "$TEST_COUNT"
  if [[ "$TEST_TIMEOUT" == true && "$n" == 1 ]]; then sleep 3; fi
  if [[ -n "$TEST_FAILURE" && ( "$n" == 1 || "$TEST_ALWAYS_FAIL" == true ) ]]; then echo "$TEST_FAILURE"; exit 100; fi
fi
if [[ " $* " == *' --no-download '* && "$TEST_INSTALL_FAIL" == true ]]; then echo 'E: Sub-process /usr/bin/dpkg returned an error code (1)'; exit 100; fi
`, { mode: 0o755 });
  const result = spawnSync('bash', [resolve('scripts/ci/install-system-packages.sh'), ...(options.downloadOnly ? ['--download-only'] : []), 'fontconfig'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAPGRID_APT_MIRRORLIST: mirror,
      CLAPGRID_APT_CACHE_DIR: join(root, 'cache'), CLAPGRID_APT_LOG: join(root, 'dependency.log'),
      GITHUB_STEP_SUMMARY: summary, CLAPGRID_APT_CACHE_HIT: 'true', CLAPGRID_APT_PRIMARY_SECONDS: '1', CLAPGRID_APT_FALLBACK_SECONDS: '2',
      TEST_CALLS: calls, TEST_COUNT: join(root, 'count'), TEST_FAILURE: options.failure ?? '', TEST_ALWAYS_FAIL: String(options.alwaysFail ?? false),
      TEST_INSTALL_FAIL: String(options.installFail ?? false), TEST_TIMEOUT: String(options.timeout ?? false) },
    encoding: 'utf8', timeout: 10000,
  });
  return { ...result, summary: readFileSync(summary, 'utf8'), mirror: readFileSync(mirror, 'utf8'), calls: readFileSync(calls, 'utf8') };
}

test('下载网络故障后只恢复一次，降低 azure 显式优先级并只安装调用方包', () => {
  const result = run({ failure: 'E: Could not connect to azure.archive.ubuntu.com' });
  expect(result.status).toBe(0);
  expect(result.summary).toContain('recovered；尝试 2 次；缓存命中 true');
  expect(result.mirror).toBe('https://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:4\n');
  expect(result.calls).toContain('--download-only ffmpeg fontconfig fonts-noto-cjk strace');
  expect(result.calls).toContain('--no-download fontconfig\n');
  expect(result.stdout).toContain('reason=network-error');
});

test('两次下载均网络失败时保留失败摘要，禁止安装或第三次尝试', () => {
  const result = run({ failure: 'E: Temporary failure resolving archive.ubuntu.com', alwaysFail: true });
  expect(result.status).toBe(100);
  expect(result.summary).toContain('failed；尝试 2 次');
  expect(result.calls).not.toContain('--no-download');
});

test.each([
  "E: Clearsigned file isn't valid, got 'NOSPLIT'\nE: Could not connect to mirror",
  'E: Hash Sum mismatch',
  'E: The repository is not signed. Could not connect to mirror',
  'E: Unable to locate package missing',
  'E: Package missing has no installation candidate',
  'E: Unknown apt error',
])('不可恢复的下载错误直接失败：%s', failure => {
  const result = run({ failure });
  expect(result.status).toBe(100);
  expect(result.summary).toContain('failed；尝试 1 次');
  expect(result.mirror).toContain('azure.archive.ubuntu.com/ubuntu/\tpriority:1');
  expect(result.calls).not.toContain('--no-download');
});

test('dpkg 安装失败不换源、不重试，失败码传播', () => {
  const result = run({ installFail: true });
  expect(result.status).toBe(100);
  expect(result.summary).toContain('failed；尝试 1 次');
  expect(result.calls.match(/--no-download/g)).toHaveLength(1);
});

test('真实外层超时终止首轮下载，第二轮恢复并记录期限', () => {
  const result = run({ timeout: true });
  expect(result.status).toBe(0);
  expect(result.summary).toContain('recovered；尝试 2 次');
  expect(result.stdout).toContain('exit=124 reason=timeout');
  expect(result.stdout).toContain('budget=1s');
  expect(result.stdout).toContain('budget=2s');
});

test('预热只下载并集，不执行安装', () => {
  const result = run({ downloadOnly: true });
  expect(result.status).toBe(0);
  expect(result.summary).toContain('passed；尝试 1 次');
  expect(result.calls).toContain('--download-only ffmpeg fontconfig fonts-noto-cjk strace');
  expect(result.calls).not.toContain('--no-download');
});


test('必需依赖日志写入失败必须传播，不能报告通过', () => {
  const result = run({ logFail: true });
  expect(result.status).not.toBe(0);
  expect(result.summary).toContain('failed');
});
