import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { z } from 'zod';
import { localServiceUrl } from './shared/client.js';

export function workspaceProject(directory: string) {
  if (!directory || !isAbsolute(directory)) throw new Error('请先选择或创建本地工作空间。');
  const workspace = realpathSync(directory);
  const project = join(workspace, 'clapgrid');
  const stat = lstatSync(project, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('工作空间的 clapgrid/ 必须是普通目录，不能链接至其他位置。');
  return { workspace, project };
}

export const discoverySchema = z.object({
  workspace: z.string(), projectDirectory: z.string(), projectId: z.string(), instanceId: z.string(), url: z.string(),
});
export class WorkspaceOfflineError extends Error {}
export async function discoverWorkspace(directory: string) {
  const { workspace, project } = workspaceProject(directory);
  const file = join(project, 'service.json');
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) throw new WorkspaceOfflineError('当前工作空间的 ClapGrid 尚未打开。');
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('服务发现记录不安全。');
  const record = discoverySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (record.workspace !== workspace || record.projectDirectory !== project) throw new Error('服务发现记录属于其他工作空间。');
  const url = localServiceUrl(record.url);
  let status: Omit<z.infer<typeof discoverySchema>, 'url'>;
  try {
    const response = await fetch(`${url}/api/identity`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('offline');
    status = discoverySchema.omit({ url: true }).extend({ application: z.literal('clapgrid') }).parse(await response.json()) as Omit<z.infer<typeof discoverySchema>, 'url'>;
    if (status.instanceId !== record.instanceId || status.projectId !== record.projectId || status.projectDirectory !== project || status.workspace !== workspace) throw new Error('mismatch');
  } catch (error) {
    if (error instanceof TypeError && (error.cause as NodeJS.ErrnoException)?.code === 'ECONNREFUSED') {
      throw new WorkspaceOfflineError('服务身份已改变或不可达，请关闭重开 ClapGrid；本次不执行业务操作。', { cause: error });
    }
    throw new Error('服务身份已改变或不可达，请关闭重开 ClapGrid；本次不执行业务操作。', { cause: error });
  }
  return { ...record, url, status };
}

export async function bindWorkspace(directory: string, threadId: string) {
  const service = await discoverWorkspace(directory);
  const response = await fetch(`${service.url}/api/binding`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, workspace: service.workspace, projectId: service.projectId, instanceId: service.instanceId }),
    signal: AbortSignal.timeout(12000), redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok || typeof body.binding !== 'string') throw new Error(body.error ?? '无法核对工作空间绑定。');
  return `${service.url}/binding/${encodeURIComponent(body.binding)}`;
}
