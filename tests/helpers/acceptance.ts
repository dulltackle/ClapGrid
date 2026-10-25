import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base } from './media-project.js';
import { useProject, type Project } from './project.js';
import type { BuildIdentity } from '../../src/build-identity.js';

type Stop = { reason: 'signal'; signal: 'SIGINT' | 'SIGTERM' } | { reason: 'expired' };
type AcceptanceRecord = {
  scenario: string; sourceCommit: string; dirty: boolean; panelBuildIdentity: BuildIdentity;
  serviceUrl: string; instanceId: string; projectDirectory: string;
  pid: number; pgid: number; startedAt: string; expiresAt: string;
  evidenceScope: 'candidate-source-service';
  stop?: (Stop | { reason: 'interrupted' }) & { stoppedAt: string; cleanup: { projectRemoved: boolean; serviceClosed: boolean }; error?: string };
};
type Acceptance = { hold(scenario: string, project: Project): Promise<void>; trackProject(pending: Promise<void>): void };

async function atomicRecord(file: string, record: AcceptanceRecord) {
  await mkdir(join(file, '..'), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}

/** 不依赖 context/page；只组合既有项目与受控供应商，清理及保留现场仍由 useProject 决定。 */
export const test = base.extend<{ acceptance: Acceptance }>({
  project: async ({ panelDirectory, speechControl, projectServer, acceptance }, use) => {
    const previous = process.env.NODE_OPTIONS;
    const shield = new URL('./acceptance-media-signals.mjs', import.meta.url).href;
    process.env.NODE_OPTIONS = `${previous ?? ''} --import=${shield}`.trim();
    try {
      const pending = useProject({ panelDirectory, speechRuntime: speechControl.runtime }, projectServer, use);
      acceptance.trackProject(pending);
      await pending;
    }
    finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  },
  acceptance: async ({}, use, testInfo) => {
    const minutes = Number(process.env.CLAPGRID_ACCEPTANCE_MAX_MINUTES ?? '30');
    if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(minutes * 60000)) throw new Error('CLAPGRID_ACCEPTANCE_MAX_MINUTES 必须为有限正数');
    const startedAt = Date.now();
    const expiresAt = startedAt + minutes * 60000;
    if (!Number.isFinite(new Date(expiresAt).getTime())) throw new Error('验收到期时间超出日期范围');
    let stop: Stop | undefined;
    let finish!: () => void;
    const stopped = new Promise<void>(resolve => { finish = resolve; });
    const end = (value: Stop) => { stop ??= value; finish(); };
    const sigint = () => end({ reason: 'signal', signal: 'SIGINT' });
    const sigterm = () => end({ reason: 'signal', signal: 'SIGTERM' });
    process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
    // 分段定时避免 Node 的 2^31ms 限制，无人为分钟数上限。
    let timer: NodeJS.Timeout;
    const schedule = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) end({ reason: 'expired' });
      else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    };
    schedule();
    let record: AcceptanceRecord | undefined;
    let project: Project | undefined;
    const file = join(process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR!, 'acceptance.json');
    let failure: unknown;
    let projectCleanup = Promise.resolve();
    try {
      // acceptance 必须先于 project 建立：其 teardown 在 useProject 清理之后记录实际结果。
      await use({ trackProject: pending => { projectCleanup = pending; void pending.catch(() => {}); }, hold: async (scenario, preparedProject) => {
        project = preparedProject;
        const identity = await (await fetch(`${project.url}/api/identity`)).json() as { instanceId: string };
        const pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
        record = {
          scenario, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
          panelBuildIdentity: JSON.parse(process.env.CLAPGRID_ACCEPTANCE_PANEL_IDENTITY!),
          serviceUrl: project.url, instanceId: identity.instanceId, projectDirectory: project.directory,
          pid: process.pid, pgid, startedAt: new Date(startedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
          evidenceScope: 'candidate-source-service',
        };
        await atomicRecord(file, record);
        console.log(`验收就绪：${file}`);
        await stopped;
      } });
    } catch (error) { failure = error; throw error; }
    finally {
      // SIGINT 可能中断 Playwright 当前等待的 teardown；仍等待同一份 useProject 清理完成。
      try { await projectCleanup; } catch (error) { failure ??= error; }
      clearTimeout(timer!); process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
      if (record && project) {
        let serviceClosed = false;
        try { await fetch(`${project.url}/api/status`, { signal: AbortSignal.timeout(1000) }); }
        catch (error) { serviceClosed = (error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED'; }
        failure ??= testInfo.errors.map(error => error.message).filter(Boolean).join('；') || undefined;
        record.stop = { ...(stop ?? { reason: 'interrupted' }), stoppedAt: new Date().toISOString(),
          cleanup: { projectRemoved: !existsSync(project.directory), serviceClosed }, ...(failure ? { error: String(failure) } : {}) };
        await atomicRecord(file, record);
      }
    }
  },
});

// 每个进程只拥有一个现场；宽泛 grep 不能在停止后启动下一项目并覆盖停止记录。
let sceneStarted = false;
test.beforeEach(() => {
  if (sceneStarted) throw new Error('每轮验收只能运行一个场景，请用 --grep 选择后换新运行目录重开');
  sceneStarted = true;
});

export { expect } from '@playwright/test';
