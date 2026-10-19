import { buildIdentity, compatibleRuntime } from './build-identity.js';
import { verifyLoadedPlugin } from './plugin-release.js';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { readHostWorkspace } from './host-workspace.js';
import { workspaceProject, discoverWorkspace, bindWorkspace } from './workspace-service.js';
import { projectPaths } from './business/project-paths.js';
import { queryStatus } from './shared/client.js';

export async function workspaceRuntime(action: 'open' | 'workspace-status' | 'workspace-stop', args: string[]) {
  const { values } = parseArgs({ args, options: { workspace: { type: 'string' }, thread: { type: 'string' }, interrupt: { type: 'boolean', default: false }, 'allow-offline': { type: 'boolean', default: false }, 'idle-only': { type: 'boolean', default: false } } });
  if (values.interrupt && action !== 'workspace-stop') throw new Error('--interrupt 仅用于明确中断任务并退出。');
  if (!values.workspace || !values.thread) throw new Error('请先选择或创建本地工作空间；打开入口需要宿主提供的工作空间和聊天身份。');
  const { workspace, project } = workspaceProject(values.workspace);
  if (await readHostWorkspace(values.thread) !== workspace) throw new Error('宿主当前工作空间已改变，请重新打开。');
  if (action === 'open') await verifyLoadedPlugin();
  let found = false;
  try { await discoverWorkspace(workspace); found = true; }
  catch (error) {
    if (action === 'workspace-status' && values['allow-offline']
      && ((error as Error).cause as { cause?: NodeJS.ErrnoException })?.cause?.code === 'ECONNREFUSED') return { state: 'offline', workspace };
    if (action !== 'open') throw error;
    const message = error instanceof Error ? error.message : '';
    const offline = error instanceof TypeError && (error.cause as NodeJS.ErrnoException)?.code === 'ECONNREFUSED';
    if (!offline && !message.includes('尚未打开') && !message.includes('服务身份已改变')) throw error;
  }
  if (!found) {
    projectPaths(project);
    const log = openSync(join(project, 'service.log'), 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./service/main.js', import.meta.url)), '--workspace', workspace, '--port', '0'], {
      detached: true, stdio: ['ignore', log, log], windowsHide: true,
    });
    closeSync(log);
    let failure: Error | undefined;
    child.on('error', error => { failure = error; }); child.unref();
    let candidate: { instanceId: string; pid: number } | undefined;
    for (let attempt = 0; attempt < 60; attempt++) {
      await setTimeout(100);
      if (failure) throw failure;
      let service: Awaited<ReturnType<typeof discoverWorkspace>>;
      try { service = await discoverWorkspace(workspace); }
      catch { continue; /* 同项目并发打开时等待持有所有权的服务发布身份。 */ }
      if (candidate?.instanceId !== service.instanceId) {
        const status = await queryStatus(await bindWorkspace(workspace, values.thread));
        candidate = { instanceId: status.instanceId, pid: status.pid };
      }
      // 另一服务发布身份时，本次候选仍可能在等待所有权；它退出前返回会让停止后的项目被重新打开。
      if (candidate.pid === child.pid || child.exitCode !== null || child.signalCode !== null) { found = true; break; }
    }
    if (!found) throw new Error('服务启动未确认，请检查 clapgrid/service.log；不会自动重复启动。');
  }
  const url = await bindWorkspace(workspace, values.thread);
  const status = await queryStatus(url);
  if (action === 'open' && buildIdentity.state === 'known' && (status.buildIdentity?.state !== 'known' || !compatibleRuntime(status.buildIdentity, buildIdentity))) throw new Error('服务版本与插件不一致，请执行插件更新流程；保留运行中的任务。');
  if (action === 'workspace-stop') {
    if (values['idle-only'] && (status.taskLocked || status.modification)) return { outcome: 'kept', message: '项目忙碌，更新等待任务和编辑结束。' };
    const response = await fetch(`${url}/api/service/stop`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: status.instanceId, interrupt: values.interrupt, ...(values['idle-only'] && status.idleStopSupported ? { idleOnly: true } : {}) }),
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('退出未确认，请查询项目状态。');
    return response.json();
  }
  return { ...status, workspace, threadId: values.thread, url };
}
