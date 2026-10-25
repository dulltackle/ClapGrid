import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';

// 对外入口及其清理结果是测试边界；不使用浏览器，也不替换真实服务。
test.each(['SIGTERM', 'SIGINT', 'expired', 'multiple'] as const)('验收空项目 %s 后关闭端口、删除临时项目并保留停止记录', async reason => {
  const directory = await mkdtemp(join(tmpdir(), 'clapgrid-acceptance-test-'));
  const runDirectory = join(directory, 'run');
  const env: NodeJS.ProcessEnv = { ...process.env, CLAPGRID_PLAYWRIGHT_RUN_DIR: runDirectory, CHROME_BIN: '/not-a-browser' };
  delete env.TEST_WORKER_INDEX;
  delete env.CLAPGRID_ACCEPTANCE_MAX_MINUTES;
  if (reason === 'expired' || reason === 'multiple') env.CLAPGRID_ACCEPTANCE_MAX_MINUTES = '0.03';
  const child = spawn('setsid', [process.execPath, resolve('node_modules/playwright/cli.js'), 'test', '-c', 'playwright.acceptance.config.ts', ...(reason === 'SIGTERM' ? [] : ['--grep', reason === 'multiple' ? '.*' : '空项目$'])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  let passed = false;
  let hasExited = false;
  void exited.then(() => { hasExited = true; });
  try {
    await expect.poll(() => { if (hasExited) throw new Error(output); return existsSync(join(runDirectory, 'acceptance.json')); }, { timeout: 45000 }).toBe(true);
    const record = JSON.parse(await readFile(join(runDirectory, 'acceptance.json'), 'utf8'));
    expect(record).toMatchObject({ scenario: '空项目', evidenceScope: 'candidate-source-service', pgid: child.pid });
    expect(record.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(typeof record.dirty).toBe('boolean');
    expect(record.panelBuildIdentity).toHaveProperty('schemaVersion');
    expect(record.instanceId).toMatch(/^[a-f0-9-]{36}$/);
    expect(new URL(record.serviceUrl).hostname).toBe('127.0.0.1');
    expect(existsSync(record.projectDirectory)).toBe(true);
    expect((await fetch(`${record.serviceUrl}/api/status`)).ok).toBe(true);
    expect(output).toContain(join(runDirectory, 'acceptance.json'));
    expect(Date.parse(record.expiresAt) - Date.parse(record.startedAt)).toBe(reason === 'expired' || reason === 'multiple' ? 1800 : 30 * 60000);
    if (reason === 'SIGTERM' || reason === 'SIGINT') process.kill(-record.pgid, reason);
    await expect.poll(async () => JSON.parse(await readFile(join(runDirectory, 'acceptance.json'), 'utf8')).stop, { timeout: 15000 }).toMatchObject({ ...(reason === 'expired' || reason === 'multiple' ? { reason: 'expired' } : { reason: 'signal', signal: reason }), cleanup: { projectRemoved: true, serviceClosed: true } });
    await expect.poll(() => hasExited, { timeout: 15000 }).toBe(true);
    const result = await exited;
    if (reason === 'expired') expect(result).toEqual({ code: 0, signal: null });
    if (reason === 'multiple') {
      expect(result).toEqual({ code: 1, signal: null });
      expect(output).toContain('每轮验收只能运行一个场景');
      expect(JSON.parse(await readFile(join(runDirectory, 'acceptance.json'), 'utf8')).scenario).toBe('空项目');
      expect(output.match(/验收就绪：/g)).toHaveLength(1);
    }
    expect(existsSync(record.projectDirectory)).toBe(false);
    await expect(fetch(`${record.serviceUrl}/api/status`)).rejects.toThrow();
    passed = true;
  } finally {
    if (!hasExited && child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await Promise.race([exited, delay(15000)]);
    }
    // 未确认退出时保留证据；不扫描或删除未知项目。
    if (hasExited && passed) await rm(directory, { recursive: true, force: true });
    else console.error(`验收未通过或退出未确认，保留 ${directory}；${output}`);
  }
}, 70000);
