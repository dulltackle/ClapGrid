import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { TriangleRightIcon, PauseIcon, ReloadIcon, ChevronDownIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/index.js';
import type { Segment, SpeechStatus } from '../shared/contracts.js';
import type { SegmentActions } from './segment-actions.js';

type Recording = SpeechStatus['audio'][number];
type Playback = {
  playing: string | null; listening: Recording | null; player: RefObject<HTMLAudioElement | null>;
  stop: () => void; listen: (audio: Recording) => void;
};

function formatTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function AudioDuration({ url }: { url: string }) {
  const [duration, setDuration] = useState<number>();
  return <>
    <audio src={url} preload="metadata" hidden onLoadedMetadata={event => {
      const seconds = event.currentTarget.duration;
      if (Number.isFinite(seconds)) setDuration(seconds);
    }} />
    {duration === undefined ? '—' : formatTime(duration)}
  </>;
}

// 保留原生滑块的输入行为，并分别设置 WebKit 与 Firefox 的轨道和圆点。
const seekAppearance = 'appearance-none rounded-sm bg-transparent '
  + '[--seek-track:linear-gradient(to_right,var(--color-ok)_var(--seek-progress),var(--color-border)_var(--seek-progress))] '
  + '[--seek-thumb:color-mix(in_srgb,var(--color-ok)_55%,var(--color-surface))] hover:[--seek-thumb:var(--color-ok)] focus-visible:[--seek-thumb:var(--color-ok)] '
  + '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-(image:--seek-track) '
  + '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-(image:--seek-track) '
  + '[&::-webkit-slider-thumb]:-mt-0.5 [&::-webkit-slider-thumb]:size-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--seek-thumb) '
  + '[&::-moz-range-thumb]:size-2 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-(--seek-thumb)';

function Seek({ player, recording }: { player: Playback['player']; recording: Recording }) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    const update = () => { setTime(audio.currentTime); setDuration(Number.isFinite(audio.duration) ? audio.duration : 0); };
    audio.addEventListener('timeupdate', update);
    audio.addEventListener('loadedmetadata', update);
    update();
    return () => { audio.removeEventListener('timeupdate', update); audio.removeEventListener('loadedmetadata', update); };
  }, [player, recording]);
  const elapsed = Math.min(time, duration);
  return <span className="flex w-[110px] min-w-8 items-center gap-1.5 max-[600px]:h-8 max-[600px]:flex-col max-[600px]:justify-center max-[600px]:gap-0">
    <input aria-label="配音进度" aria-valuetext={`已播放 ${elapsed.toFixed(1)} 秒，共 ${duration.toFixed(1)} 秒`} type="range" min={0} max={duration || 1} step={0.1} value={elapsed}
      className={`h-8 min-w-8 flex-1 cursor-pointer max-[600px]:h-4 max-[600px]:w-full max-[600px]:flex-none ${seekAppearance}`}
      style={{ '--seek-progress': `${duration ? elapsed / duration * 100 : 0}%` } as CSSProperties}
      onChange={event => {
        const next = Number(event.target.value);
        if (player.current) player.current.currentTime = next;
        setTime(next);
      }} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
      }} />
    <span className="shrink-0 text-xs leading-4 tabular-nums text-muted-foreground">{formatTime(elapsed)}</span>
  </span>;
}

/** 配音状态、试听和更多操作均在配音列；播放进度保留在当前行。 */
export function SegmentSpeechCell({ data, actionsFor, segmentEditingBusy, playing, listening, player, stop, listen, generate, history }: Playback & {
  data?: Segment; actionsFor: (segment: Segment) => SegmentActions; segmentEditingBusy?: boolean;
  generate: (id: string, trigger: HTMLElement) => void; history: (id: string, trigger: HTMLElement) => void;
}) {
  const menu = useRef<HTMLButtonElement>(null);
  const listenButton = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);
  if (!data) return null;
  const { latest, audio, primaryLabel, generate: generateAction } = actionsFor(data);
  const pending = latest?.state === 'accepted' || latest?.state === 'running';
  const problem = latest?.state === 'failed' || latest?.state === 'unknown';
  const active = listening?.segmentId === data.id ? listening : null;
  const recording = active ?? (!problem ? audio : undefined);
  const valid = !!recording && !!audio?.valid && audio.taskId === recording.taskId;
  const isPlaying = !!active && playing === active.taskId;
  const showDuration = valid && !active && !pending;
  const showStatus = !audio?.valid || pending || problem;
  const label = pending ? '生成中…' : primaryLabel;
  return <section data-segment-speech data-playing={isPlaying || undefined} aria-label={`片段 ${data.order} 配音`} className="flex w-full items-center gap-0.5 pt-2"
    onKeyDown={event => {
      if (!active || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented || !event.target || !event.currentTarget.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation();
      (pending || problem ? menu.current : listenButton.current)?.focus({ preventScroll: true });
      stop();
    }}>
    {recording && <>
      <Button ref={listenButton} data-row-entry="speech-listen" variant={showDuration || active ? 'outline' : 'ghost'} size="icon-sm"
        className={showDuration ? 'w-auto gap-1 px-2 tabular-nums text-ok hover:text-ok' : undefined}
        aria-label={active ? isPlaying ? '暂停试听' : '继续试听' : valid ? '试听' : '试听旧配音'}
        title={valid ? '有效配音' : '试听旧配音'} onClick={() => listen(recording)}>
        {isPlaying ? <PauseIcon aria-hidden /> : <TriangleRightIcon aria-hidden />}
        {showDuration && <AudioDuration key={recording.url} url={recording.url} />}
      </Button>
      {active && <Seek key={active.taskId} player={player} recording={active} />}
    </>}
    {showStatus && <Button data-row-entry="speech" variant="outline" size="sm"
      className={`gap-0.5 px-1.5 has-[>svg]:px-1.5 disabled:pointer-events-auto ${active ? 'size-8 p-0 has-[>svg]:px-0' : ''} ${problem ? 'border-destructive/25 bg-error-surface text-destructive hover:bg-error-surface hover:text-destructive'
        : pending ? 'text-running disabled:opacity-100'
        : audio ? 'border-warning/25 bg-warning-surface text-warning hover:bg-warning-surface hover:text-warning' : ''} ${segmentEditingBusy && generateAction.reason !== '请先填写文案' ? 'disabled:opacity-100' : ''}`}
      aria-label={problem ? `${label}，查看错误说明` : label}
      aria-haspopup={problem ? 'dialog' : undefined}
      title={problem ? '查看错误说明' : generateAction.reason || (audio ? '文案或声音设置已变化，点击重新生成' : label)}
      disabled={pending || (!problem && !generateAction.enabled)}
      onClick={event => problem ? history(data.id, event.currentTarget) : generate(data.id, event.currentTarget)}>
      {problem ? <ExclamationTriangleIcon aria-hidden /> : <ReloadIcon aria-hidden className={pending ? 'animate-spin motion-reduce:animate-none' : ''} />}<span className={active ? 'sr-only' : undefined}>{label}</span>
    </Button>}
    <DropdownMenu modal={false} onOpenChange={open => { if (open) handoff.current = false; }}>
      <DropdownMenuTrigger asChild><Button ref={menu} variant="ghost" size="icon-sm" className="text-muted-foreground" data-speech-more data-row-entry="speech-menu" aria-label={`片段 ${data.order} 配音更多操作`}><ChevronDownIcon aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={`片段 ${data.order} 配音操作`} onCloseAutoFocus={event => { if (handoff.current) event.preventDefault(); }} onClick={event => event.stopPropagation()}>
        <DropdownMenuItem data-speech-generate aria-label="重新生成" aria-description={generateAction.reason || undefined} disabled={!generateAction.enabled} title={generateAction.reason} onSelect={() => { if (menu.current) { handoff.current = latest?.state === 'unknown'; generate(data.id, menu.current); } }}>重新生成{generateAction.reason && <span className="text-xs"> · {generateAction.reason}</span>}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (menu.current) { handoff.current = true; history(data.id, menu.current); } }}>配音记录与保留音频</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </section>;
}
