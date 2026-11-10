import { Button } from '@/components/ui/index.js';
import { panelServiceUrl } from './service-url.js';
import { useEffect, useState } from 'react';
import { cancelExport, queryExports, queryStatus, submitExport } from '../shared/client.js';
import type { ExportTask, ExportTasksStatus, ServiceStatus, Segment, SpeechStatus, SpeechTask } from '../shared/contracts.js';

export function useExportTasks(onStatus: (status: ServiceStatus) => void) {
  const [exports, setExports] = useState<ExportTasksStatus>();
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await queryExports(panelServiceUrl()); if (active) { setExports(result); setConnectionError(''); } }
      catch (error) { if (active) setConnectionError((error as Error).message); }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const run = async (taskId?: string) => {
    setBusy(true); setOperationError('');
    try {
      if (taskId) await cancelExport(panelServiceUrl(), taskId);
      else await submitExport(panelServiceUrl());
      setExports(await queryExports(panelServiceUrl()));
      setConnectionError('');
      onStatus(await queryStatus(panelServiceUrl()));
    } catch (error) { setOperationError(`${(error as Error).message}；请查询任务确认是否已受理，不会自动重发。`); }
    finally { setBusy(false); }
  };
  return { exports, busy, operationError, connectionError, run };
}

type Progress = { label: string; task?: ExportTask };

export function taskProgress(speech: SpeechStatus | undefined, exports: ExportTask[], previews: ExportTask[]): Progress[] {
  const activeBatch = speech?.operations.filter(operation => operation.summary.pending > 0).at(-1);
  const speechActive = speech?.tasks.some(task => task.state === 'accepted' || task.state === 'running');
  const progress: Progress[] = [];
  if (activeBatch) {
    const { completed, pending } = activeBatch.summary;
    progress.push({ label: `配音 ${completed}/${completed + pending}` });
  } else if (speechActive) progress.push({ label: '配音生成中' });
  for (const [label, tasks] of [['导出', exports], ['片段合成', previews]] as const) {
    const task = tasks.filter(task => ['accepted', 'validating', 'rendering', 'cleaning'].includes(task.state)).at(-1);
    if (task) progress.push({ label: `${label} ${task.completed}/${task.total}`, task });
  }
  return progress;
}

export const isTaskProblem = (task: ExportTask) => task.state === 'failed' || task.state === 'interrupted';

function formatLoudnessValue(value: number) { return value.toFixed(1).replace('-', '−'); }

export function TaskDetails({ progress, speechProblems, exportProblems, exportTasks, segments, cancel, cancelBusy, errors, retry, retryReason }: {
  progress: Progress[];
  speechProblems: { task: SpeechTask; segment: Segment }[];
  exportProblems: ExportTask[];
  exportTasks: ExportTask[];
  segments: Segment[];
  cancel: (id: string) => void;
  cancelBusy: boolean;
  errors: string[];
  retry: (id: string, trigger: HTMLElement) => void;
  retryReason: (segment: Segment) => string;
}) {
  const completed = exportTasks.filter(task => task.state === 'succeeded' && task.output).reverse();
  if (!errors.length && !progress.length && !speechProblems.length && !exportProblems.length && !completed.length) return <p className="m-0 text-muted-foreground">暂无任务记录</p>;
  return <>
    {progress.length > 0 && <section aria-label="进行中" className="space-y-2">
      <h3 className="m-0 text-sm font-semibold">进行中</h3>
      {progress.map(({ label, task }) => <div key={task?.id ?? 'speech'} className="flex items-center justify-between gap-2">
        <span role="status">{label}{task?.state === 'cleaning' && ' · 正在清理'}</span>
        {task && task.state !== 'cleaning' && <Button variant="outline" size="xs" disabled={cancelBusy} onClick={() => cancel(task.id)}>{task.preview ? '取消合成' : '取消导出'}</Button>}
      </div>)}
    </section>}
    {(errors.length > 0 || speechProblems.length > 0 || exportProblems.length > 0) && <section aria-label="待处理问题" className="space-y-2">
      <h3 className="m-0 text-sm font-semibold">待处理问题</h3>
      {errors.map(message => <p key={message} role="alert" className="m-0 text-destructive">{message}</p>)}
      {speechProblems.map(({ task, segment }) => {
        const reason = retryReason(segment);
        return <article key={task.id} className="space-y-1 rounded-md border border-solid border-input p-2">
          <h4 className="m-0 text-sm font-medium">片段 {segment.order} · {task.state === 'unknown' ? '配音结果未知，可能已计费' : '配音失败'}</h4>
          <p className="m-0">{task.message}</p>
          <Button variant="outline" size="xs" disabled={!!reason} title={reason} onClick={event => retry(segment.id, event.currentTarget)}>重试配音</Button>
        </article>;
      })}
      {exportProblems.slice().reverse().map(task => {
        const order = task.preview && segments.find(segment => segment.id === task.preview?.segmentId)?.order;
        const label = task.preview ? `片段 ${order} 合成` : '导出';
        return <article key={task.id} className="space-y-1 rounded-md border border-solid border-input p-2">
          <h4 className="m-0 text-sm font-medium">{label}{task.state === 'failed' ? '失败' : '已中断'}</h4>
          <p className="m-0">{task.preview ? task.message.replaceAll('导出', '合成') : task.message}</p>
          {task.issues.length > 0 && <ul aria-label={task.preview ? '合成错误' : '导出错误'} className="m-0 list-disc pl-5 text-destructive">
            {task.issues.map((issue, index) => <li key={index}>{issue.order ? `片段 ${issue.order}` : issue.field === 'settings' ? '导出设置' : '项目'}：{issue.message}</li>)}
          </ul>}
        </article>;
      })}
    </section>}
    {completed.length > 0 && <section aria-label="已完成成片" className="space-y-2">
      <h3 className="m-0 text-sm font-semibold">已完成成片</h3>
      {completed.map(task => <details key={task.id} className="rounded-md border border-solid border-input p-2 [&_p]:my-2">
        <summary className="cursor-pointer font-medium">导出成功 · {new Date(task.createdAt).toLocaleString()}</summary>
        {task.technicalChecks?.loudnessAfter && <p>成片响度 {formatLoudnessValue(task.technicalChecks.loudnessAfter.integratedLufs)} LUFS · 真峰值 {formatLoudnessValue(task.technicalChecks.loudnessAfter.truePeakDbtp)} dBTP</p>}
        {task.warnings.length > 0 && <ul aria-label="导出警告" className="my-2 list-disc pl-5 text-muted-foreground">{task.warnings.map((issue, index) => <li key={index}>{issue.order === undefined ? '全片' : `片段 ${issue.order}`}：{issue.message}</li>)}</ul>}
        {task.output && <p><a className="text-primary underline underline-offset-2" href={task.output.previewUrl ?? task.output.url} target="_blank" rel="noreferrer">打开成片</a> · <a className="text-primary underline underline-offset-2" href={task.output.url} download>下载 MP4 原片</a><small className="text-muted-foreground">（浏览器播放使用兼容预览）</small></p>}
      </details>)}
    </section>}
  </>;
}
