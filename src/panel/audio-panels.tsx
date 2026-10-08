import { Button } from '@/components/ui/index.js';
import { DetailPanel } from './detail-panel.js';
import type { SpeechStatus } from '../shared/contracts.js';

type Audio = SpeechStatus['audio'][number];
type Closing = { onClose: () => void; restoreFocus: () => void };

export function AudioHistoryPanel({ segmentId, speech, onClose, restoreFocus }: Closing & { segmentId: string; speech: SpeechStatus | undefined }) {
  const audio = speech?.audio.filter(audio => audio.segmentId === segmentId).slice().reverse() ?? [];
  return <DetailPanel label="保留音频" title="配音详情与保留音频" description="查看配音任务记录与保留音频，音频按由新到旧的顺序排列。" onClose={onClose} restoreFocus={restoreFocus}>
    <section aria-label="配音任务记录" className="space-y-2">{speech?.tasks.filter(task => task.segmentId === segmentId).slice().reverse().map(task => <p className="m-0" key={task.id}>任务 {task.id} · 请求 {task.requestId}：{({ accepted: '已受理', running: '生成中', succeeded: '生成成功', failed: '生成失败', unknown: '结果未知，可能已计费' })[task.state]}<br />{task.message}</p>)}</section>
    {!audio.length && <p className="m-0">暂无保留音频</p>}
    <ul className="m-0 list-none p-0">{audio.map(audio => <li className="border-0 border-t border-solid border-[var(--color-border)] py-3" key={audio.taskId}>
      <p className="mt-0 mb-2"><time dateTime={audio.createdAt}>{new Date(audio.createdAt).toLocaleString()}</time> · {audio.valid ? '有效配音' : '配音待更新'}</p>
      <p className="mt-0 mb-2 whitespace-pre-wrap">{audio.input.text}</p>
      <audio className="mb-3 block w-full" controls preload="none" src={audio.url} aria-label={`试听 ${audio.input.text}`} />
    </li>)}</ul>
    <Button variant="outline" className="self-start shrink-0" onClick={onClose}>关闭</Button>
  </DetailPanel>;
}

export function AudioListeningPanel({ audio, currentAudio, onClose, restoreFocus, onError }: Closing & { audio: Audio; currentAudio: Audio | undefined; onError: () => void }) {
  return <DetailPanel label="配音试听" title="配音试听" description={!currentAudio ? '配音状态无法确认：此音频已不在当前保留音频列表中。' : currentAudio.valid ? '有效配音' : '配音待更新：此音频与当前文案或声音设置不一致。'} onClose={onClose} restoreFocus={restoreFocus}>
    <audio className="mb-3 block w-full shrink-0" controls autoPlay src={audio.url} aria-label="配音试听播放器" onError={onError} />
    <Button variant="outline" className="self-start shrink-0" onClick={onClose}>关闭试听</Button>
  </DetailPanel>;
}
