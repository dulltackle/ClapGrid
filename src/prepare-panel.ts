import { buildIdentity } from './build-identity.js';
import { verifyLoadedPlugin } from './plugin-release.js';
import { hostThreadId, readHostWorkspace } from './host-workspace.js';
import { bindWorkspace, workspaceProject, WorkspaceOfflineError } from './workspace-service.js';
import { queryStatus } from './shared/client.js';

/** 快速重开只连接现有服务；仅明确离线才允许进入组件准备和启动流程。 */
export async function preparePanel(meta: Record<string, unknown> | undefined) {
  await verifyLoadedPlugin();
  const threadId = hostThreadId(meta);
  const { workspace, project } = workspaceProject(await readHostWorkspace(threadId));
  let url: string;
  try { url = await bindWorkspace(workspace, threadId); }
  catch (error) {
    if (error instanceof WorkspaceOfflineError) return { state: 'needs-start' as const, workspace, threadId };
    throw error;
  }
  const status = await queryStatus(url);
  if (buildIdentity.state !== 'known' || status.buildIdentity?.state !== 'known'
    || status.buildIdentity.contentFingerprint !== buildIdentity.contentFingerprint) {
    throw new Error('服务版本与插件不一致或版本未知，请执行插件更新诊断。');
  }
  if (status.snapshot.project.directory !== project) throw new Error('项目目录与当前工作空间不符，请关闭重开。');
  return { state: 'ready' as const, workspace, threadId, url, buildIdentity,
    instanceId: status.instanceId, project: status.snapshot.project,
    taskLocked: status.taskLocked, modification: status.modification };
}
