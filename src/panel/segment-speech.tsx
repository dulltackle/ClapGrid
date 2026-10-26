import { useRef } from 'react';
import { TriangleRightIcon, PauseIcon, ReloadIcon, DotsHorizontalIcon, DotFilledIcon } from '@radix-ui/react-icons';
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/index.js';
import type { Segment, SpeechStatus } from '../shared/contracts.js';

export function segmentSpeech(segmentId: string, speech: SpeechStatus | undefined) {
  const latest = speech?.tasks.filter(task => task.segmentId === segmentId).at(-1);
  const recordings = speech?.audio.filter(audio => audio.segmentId === segmentId) ?? [];
  const audio = recordings.filter(audio => audio.valid).at(-1) ?? recordings.at(-1);
  const state = latest && latest.state !== 'succeeded' ? ({ accepted: '排队中', running: '生成中', failed: '生成失败', unknown: '结果未知' })[latest.state] : audio ? audio.valid ? '有效配音' : '配音待更新' : '未生成';
  const generateLabel = latest?.state === 'failed' || latest?.state === 'unknown' ? '重试配音' : audio || latest ? '重新生成' : '生成配音';
  return { latest, audio, state, generateLabel };
}

/** 表格行尾与详情复用同一组配音操作；菜单关闭交接仍由真实入口负责。 */
export function SegmentSpeechMenu({ segment, speech, disabled, draftText, generate, history }: {
  segment: Segment; speech: SpeechStatus | undefined; disabled: boolean; draftText?: string; generate: () => void;
  history: (trigger: HTMLElement) => void;
}) {
  const { latest, generateLabel } = segmentSpeech(segment.id, speech);
  const pending = latest?.state === 'accepted' || latest?.state === 'running';
  const trigger = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);
  return <DropdownMenu modal={false} onOpenChange={open => { if (open) handoff.current = false; }}>
    <DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" size="xs" className="h-7 w-7 shrink-0 rounded-md p-0" data-speech-more aria-label={`片段 ${segment.order} 配音更多操作`} title="配音更多操作"><DotsHorizontalIcon aria-hidden className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" aria-label={`片段 ${segment.order} 配音操作`} onCloseAutoFocus={event => { if (handoff.current) event.preventDefault(); }} onClick={event => event.stopPropagation()}>
      <DropdownMenuItem data-speech-generate disabled={disabled || !(draftText ?? segment.text).trim() || pending} onSelect={generate}>{generateLabel}</DropdownMenuItem>
      <DropdownMenuItem data-speech-history onSelect={() => { if (trigger.current) { handoff.current = true; history(trigger.current); } }}>保留音频与任务记录</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** 状态来自服务输入快照；控件不推测任务完成或配音有效性。 */
export function SegmentSpeech({ segment, speech, disabled, draftText, reason, playing, generate, listen, history, detail = false, onError }: {
  segment: Segment; speech: SpeechStatus | undefined; disabled: boolean; draftText?: string; reason: string; playing: string | null;
  generate: () => void; listen: (audio: SpeechStatus['audio'][number]) => void; history: (trigger: HTMLElement) => void;
  detail?: boolean; onError: () => void;
}) {
  const { latest, audio, state, generateLabel } = segmentSpeech(segment.id, speech);
  const problem = latest?.state === 'failed' || latest?.state === 'unknown';
  const explanation = !(draftText ?? segment.text).trim() ? '请先填写文案' : reason;
  const pending = latest?.state === 'accepted' || latest?.state === 'running';
  const statusLine = (label: string, tone: string, spinning = false) => <span className="flex items-center gap-1 text-[12px] text-muted-foreground">{spinning ? <ReloadIcon aria-hidden className="size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none" /> : <DotFilledIcon aria-hidden className={`size-3 shrink-0 ${tone}`} />}<span className={tone === 'text-destructive' ? tone : undefined}>{label}</span></span>;
  return <section data-segment-speech title={explanation || undefined} aria-label={detail ? '详情配音' : `片段 ${segment.order} 配音`} className={detail ? 'space-y-2' : 'flex shrink-0 items-center gap-2 leading-5'}>
    {!detail && <div role="group" aria-label="配音操作" className="flex min-w-0 items-center gap-1">
      <Button variant={audio || pending ? 'outline' : problem ? 'outline' : 'default'} size="xs"
        className={`h-7 min-w-0 gap-1 shrink-0 rounded-md px-2.5 text-[12px] has-[>svg]:px-2.5 ${!audio && problem ? 'border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/10' : ''}`}
        aria-label={audio ? playing === audio.taskId ? '暂停试听' : '试听' : pending ? state : generateLabel}
        title={audio ? audio.valid ? '试听配音' : '试听配音（待更新）' : explanation || generateLabel}
        disabled={!audio && (disabled || !(draftText ?? segment.text).trim() || pending)} onClick={() => audio ? listen(audio) : generate()}>
        {audio ? playing === audio.taskId ? <PauseIcon aria-hidden className="size-4 text-primary" /> : <TriangleRightIcon aria-hidden className="size-4 text-primary" /> : <ReloadIcon aria-hidden className={`size-3 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />}
        <span>{audio ? playing === audio.taskId ? '暂停' : '试听' : pending ? state : generateLabel}</span>
      </Button>
    </div>}
    <div className="flex items-center gap-2">{detail && <h3 className="m-0 font-medium">配音</h3>}
      <div role="status" className="min-w-0" title={latest?.message}>
        {audio && latest && latest.state !== 'succeeded' && statusLine(audio.valid ? '有效配音' : '配音待更新', audio.valid ? 'text-green-600' : 'text-amber-500')}
        {statusLine(!detail && pending && !audio ? '请稍候' : state, problem ? 'text-destructive' : pending ? 'text-primary' : audio ? audio.valid ? 'text-green-600' : 'text-amber-500' : 'text-muted-foreground', pending)}
      </div>
      {detail && <Button size="sm" variant="outline" className="ml-auto" title={explanation || generateLabel} disabled={disabled || !(draftText ?? segment.text).trim()} onClick={generate}>{generateLabel}</Button>}
    </div>
    {detail && <>
      {audio && <audio key={audio.url} controls preload="none" className="block w-full" aria-label="详情配音播放器" src={audio.url} onError={onError} />}
      {explanation && <p className="m-0 text-xs text-muted-foreground">{explanation}</p>}
      {problem && <p role="alert" className="m-0 text-xs text-destructive">{latest.message}{latest.state === 'unknown' && '；可能已计费，请核对任务后决定是否重试。'}</p>}
      <Button variant="ghost" size="xs" onClick={event => history(event.currentTarget)}>保留音频</Button>
    </>}
  </section>;
}
