import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/index.js';
import type { Segment, SpeechStatus } from '../shared/contracts.js';

export function segmentSpeech(segmentId: string, speech: SpeechStatus | undefined) {
  const latest = speech?.tasks.filter(task => task.segmentId === segmentId).at(-1);
  const recordings = speech?.audio.filter(audio => audio.segmentId === segmentId) ?? [];
  const audio = recordings.filter(audio => audio.valid).at(-1) ?? recordings.at(-1);
  const state = latest && latest.state !== 'succeeded' ? ({ accepted: '排队中', running: '生成中', failed: '生成失败', unknown: '结果未知' })[latest.state] : audio ? audio.valid ? '有效配音' : '配音待更新' : '未生成';
  const generateLabel = latest?.state === 'failed' || latest?.state === 'unknown' ? '重试配音' : audio || latest ? '重新生成' : '生成配音';
  return { latest, audio, state, generateLabel };
}

/** 状态来自服务输入快照；控件不推测任务完成或配音有效性。 */
export function SegmentSpeech({ segment, speech, disabled, reason, playing, generate, listen, history, detail = false, onError }: {
  segment: Segment; speech: SpeechStatus | undefined; disabled: boolean; reason: string; playing: string | null;
  generate: () => void; listen: (audio: SpeechStatus['audio'][number]) => void; history: (trigger: HTMLElement) => void;
  detail?: boolean; onError: () => void;
}) {
  const { latest, audio, state, generateLabel } = segmentSpeech(segment.id, speech);
  const problem = latest?.state === 'failed' || latest?.state === 'unknown';
  const explanation = !segment.text.trim() ? '请先填写文案' : reason;
  return <section title={explanation || undefined} aria-label={detail ? '详情配音' : `片段 ${segment.order} 配音`} className={detail ? 'space-y-2' : 'flex h-full flex-col justify-center gap-1 leading-5'}>
    <div className="flex items-center gap-2">{detail && <h3 className="m-0 font-medium">配音</h3>}
      <span role="status" className={`text-xs ${problem ? 'text-destructive' : 'text-muted-foreground'}`} title={latest?.message}>{audio && latest && latest.state !== 'succeeded' ? <>{audio.valid ? '有效配音' : '配音待更新'}<br />{state}</> : state}</span>
      {detail && <Button size="sm" variant="outline" className="ml-auto" title={explanation || generateLabel} disabled={disabled || !segment.text.trim()} onClick={generate}>{generateLabel}</Button>}
    </div>
    {!detail && <div role="group" aria-label="配音操作" className="flex items-center">
      {audio && <Button variant="ghost" size="xs" className="h-7 w-7 p-0" aria-label={playing === audio.taskId ? '暂停试听' : '试听'} title={playing === audio.taskId ? '暂停试听' : audio.valid ? '试听' : '试听（待更新）'} onClick={() => listen(audio)}>{playing === audio.taskId ? 'Ⅱ' : '▷'}</Button>}
      <Button variant="ghost" size="xs" className="h-7 w-7 p-0" aria-label={generateLabel} title={explanation || generateLabel} disabled={disabled || !segment.text.trim()} onClick={generate}>↻</Button>
      <Button variant="ghost" size="xs" className="h-7 w-7 p-0" aria-label={`展开片段 ${segment.order} 的保留音频`} title="保留音频与任务记录" onClick={event => history(event.currentTarget)}>⋯</Button>
    </div>}
    {detail && <>
      {audio && <audio key={audio.url} controls preload="none" className="block w-full" aria-label="详情配音播放器" src={audio.url} onError={onError} />}
      {explanation && <p className="m-0 text-xs text-muted-foreground">{explanation}</p>}
      {problem && <p role="alert" className="m-0 text-xs text-destructive">{latest.message}{latest.state === 'unknown' && '；可能已计费，请核对任务后决定是否重试。'}</p>}
      <Button variant="ghost" size="xs" onClick={event => history(event.currentTarget)}>保留音频</Button>
    </>}
  </section>;
}

/** 固定 renderer 身份，让播放状态刷新保留原按钮与键盘焦点。 */
export function SegmentSpeechCell({ data, generate, history, ...props }: Omit<ComponentProps<typeof SegmentSpeech>, 'segment' | 'generate' | 'history'> & {
  data?: Segment; generate: (id: string) => void; history: (id: string, trigger: HTMLElement) => void;
}) {
  return data ? <SegmentSpeech {...props} segment={data} generate={() => generate(data.id)} history={trigger => history(data.id, trigger)} /> : null;
}
