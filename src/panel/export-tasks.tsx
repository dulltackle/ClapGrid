import { useEffect, useState } from 'react';
import { cancelExport, queryExports, queryStatus, submitExport } from '../shared/client.js';
import type { ExportTasksStatus, ServiceStatus } from '../shared/contracts.js';

export function ExportTasksPanel({ onStatus }: { onStatus: (status: ServiceStatus) => void }) {
  const [exports, setExports] = useState<ExportTasksStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await queryExports(window.location.origin); if (active) { setExports(result); setError(''); } }
      catch (error) { if (active) setError((error as Error).message); }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const run = async (taskId?: string) => {
    setBusy(true); setError('');
    try {
      if (taskId) await cancelExport(window.location.origin, taskId);
      else await submitExport(window.location.origin);
      setExports(await queryExports(window.location.origin));
      onStatus(await queryStatus(window.location.origin));
    } catch (error) { setError(`${(error as Error).message}；请查询任务确认是否已受理，不会自动重发。`); }
    finally { setBusy(false); }
  };
  return <section className="organization export-tasks" aria-label="全片导出">
    <div className="toolbar">
      <button disabled={busy || !exports || exports.locked} onClick={() => { void run(); }}>导出全片</button>
      <span>按项目顺序导出全部片段，筛选与勾选不改变范围</span>
    </div>
    {error && <p role="alert">{error}</p>}
    {exports?.locked && <p role="status">导出进行中，项目已锁定；关闭面板后任务继续，取消清理完成后恢复编辑。</p>}
    {exports?.tasks.slice(-5).reverse().map(task => <details key={task.id} open={task.state !== 'succeeded'}>
      <summary>{({ accepted: '已受理', validating: '正在校验', rendering: '正在导出', cleaning: '正在清理', succeeded: '导出成功', failed: '导出失败', cancelled: '已取消' })[task.state]} · {task.completed}/{task.total} 个片段 · {new Date(task.createdAt).toLocaleString()}</summary>
      <p role="status">{task.message}</p>
      <p>任务 {task.id}</p>
      {task.state === 'rendering' && <progress value={task.completed} max={task.total} aria-label="导出进度" />}
      {task.issues.length > 0 && <ul>{task.issues.map((issue, index) => <li key={index}>{issue.order ? `片段 ${issue.order}（${issue.segmentId}）` : issue.field === 'settings' ? '导出设置' : '项目'}：{issue.message}</li>)}</ul>}
      {task.warnings.length > 0 && <ul>{task.warnings.map((issue, index) => <li key={index}>片段 {issue.order}：{issue.message}</li>)}</ul>}
      {['accepted', 'validating', 'rendering'].includes(task.state) && <button disabled={busy} onClick={() => { void run(task.id); }}>取消导出</button>}
      {task.output && <p>成片位置：<span className="output-path">{task.output.path}</span> <a href={task.output.previewUrl ?? task.output.url} target="_blank" rel="noreferrer">打开成片</a> · <a href={task.output.url} download>下载 MP4 原片</a><small>（浏览器播放使用兼容预览）</small></p>}
    </details>)}
  </section>;
}
