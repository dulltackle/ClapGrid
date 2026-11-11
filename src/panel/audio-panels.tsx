import { Button } from '@/components/ui/index.js';
import { DetailPanel } from './detail-panel.js';
import type { SpeechStatus } from '../shared/contracts.js';
import { segmentSpeech } from './speech-state.js';

type Closing = { onClose: () => void; restoreFocus: () => void };

export function AudioHistoryPanel({ segmentId, speech, onClose, restoreFocus, retry, retryReason }: Closing & {
  segmentId: string; speech: SpeechStatus | undefined; retry: (trigger: HTMLElement) => void; retryReason?: string;
}) {
  const { latest } = segmentSpeech(segmentId, speech);
  const audio = speech?.audio.filter(audio => audio.segmentId === segmentId).slice().reverse() ?? [];
  return <DetailPanel label="保留音频" title="配音详情与保留音频" description="查看配音任务记录与保留音频，音频按由新到旧的顺序排列。" onClose={onClose} restoreFocus={restoreFocus} restoreWithinLayer>
    <section aria-label="配音任务记录" className="space-y-2">{speech?.tasks.filter(task => task.segmentId === segmentId).slice().reverse().map(task => <p className="m-0" key={task.id}><time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString()}</time> · {({ accepted: '已受理', running: '生成中', succeeded: '生成成功', failed: '生成失败', unknown: '结果未知，可能已计费' })[task.state]}<br />{task.message}</p>)}</section>
    {!audio.length && <p className="m-0">暂无保留音频</p>}
    <ul className="m-0 list-none p-0">{audio.map(audio => <li className="border-0 border-t border-solid border-[var(--color-border)] py-3" key={audio.taskId}>
      <p className="mt-0 mb-2"><time dateTime={audio.createdAt}>{new Date(audio.createdAt).toLocaleString()}</time> · {audio.valid ? '有效配音' : '配音待更新'}</p>
      <p className="mt-0 mb-2 whitespace-pre-wrap">{audio.input.text}</p>
      <audio className="mb-3 block w-full" controls preload="none" src={audio.url} aria-label={`试听 ${audio.input.text}`} />
    </li>)}</ul>
    <div className="flex flex-wrap gap-2">
      {(latest?.state === 'failed' || latest?.state === 'unknown') && <Button variant="outline" disabled={!!retryReason} title={retryReason} onClick={event => retry(event.currentTarget)}>重试配音</Button>}
      <Button variant="outline" onClick={onClose}>关闭</Button>
    </div>
  </DetailPanel>;
}
