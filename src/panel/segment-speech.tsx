import { useEffect, useRef, useState, type RefObject } from 'react';
import { TriangleRightIcon, PauseIcon, ReloadIcon, ChevronDownIcon, StopIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/index.js';
import type { Segment, SpeechStatus } from '../shared/contracts.js';
import type { SegmentActions } from './segment-actions.js';
export { segmentSpeech } from './speech-state.js';

function Listening({ player, playing, toggle, stop }: { player: RefObject<HTMLAudioElement | null>; playing: boolean; toggle: () => void; stop: () => void }) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    const update = () => { setTime(audio.currentTime); setDuration(Number.isFinite(audio.duration) ? audio.duration : 0); };
    audio.addEventListener('timeupdate', update); audio.addEventListener('loadedmetadata', update); update();
    return () => { audio.removeEventListener('timeupdate', update); audio.removeEventListener('loadedmetadata', update); };
  }, [player]);
  return <div aria-label="配音试听进度" className="flex w-[210px] items-center gap-1">
    <Button variant="ghost" size="xs" aria-label={playing ? '暂停试听' : '继续试听'} onClick={toggle}>{playing ? <PauseIcon aria-hidden /> : <TriangleRightIcon aria-hidden />}</Button>
    <input aria-label="配音进度" type="range" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration)} className="min-w-0 flex-1 accent-primary" onChange={event => { const next = Number(event.target.value); if (player.current) player.current.currentTime = next; setTime(next); }} />
    <span className="text-[10px] tabular-nums">{time.toFixed(0)}/{duration.toFixed(0)}秒</span>
    <Button variant="ghost" size="xs" aria-label="停止试听" onClick={stop}><StopIcon aria-hidden /></Button>
  </div>;
}

/** 行内配音入口全部使用统一的操作呈现；试听与生成互不占用范围。 */
export function SegmentSpeech({ segment, actions, draftText, segmentEditingBusy, playing, listening, player, stop, generate, listen, history }: {
  segment: Segment; actions: SegmentActions; draftText?: string; segmentEditingBusy?: boolean;
  playing: string | null; listening: SpeechStatus['audio'][number] | null; player: RefObject<HTMLAudioElement | null>; stop: () => void;
  generate: (trigger: HTMLElement) => void; listen: (audio: SpeechStatus['audio'][number]) => void; history: (trigger: HTMLElement) => void;
}) {
  const { latest, audio, primaryLabel } = actions;
  const trigger = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const restoreAfterPlayer = useRef(false);
  const handoff = useRef(false);
  const pending = latest?.state === 'accepted' || latest?.state === 'running';
  const problem = latest?.state === 'failed' || latest?.state === 'unknown';
  const canListen = !pending && !problem && audio?.valid;
  const playingAudio = listening?.segmentId === segment.id ? listening : null;
  // 修改权短暂切换时禁用生成，保持控件外观稳定。
  const keepGenerateAppearance = segmentEditingBusy && !pending && !problem && !canListen && !!(draftText ?? segment.text).trim();
  return <section data-segment-speech aria-label={`片段 ${segment.order} 配音`} className="flex shrink-0 items-center gap-0.5">
    <Popover open={!!playingAudio} onOpenChange={open => { if (!open && playingAudio) stop(); }}>
      <PopoverTrigger asChild>
        <Button ref={primary} data-row-entry="speech" variant={problem ? 'destructive' : canListen || pending ? 'outline' : 'default'} size="xs" className={`h-7 px-2 ${keepGenerateAppearance ? 'disabled:opacity-100' : ''}`}
          aria-label={problem ? `${primaryLabel}，查看错误说明` : primaryLabel}
          aria-haspopup={problem || canListen || playingAudio ? 'dialog' : undefined} aria-expanded={canListen || playingAudio ? !!playingAudio : undefined}
          title={problem ? '查看错误说明' : canListen ? '试听配音' : actions.generate.reason || primaryLabel}
          disabled={pending || (!problem && !canListen && !actions.generate.enabled)}
          onClick={event => {
            event.preventDefault();
            if (problem) history(event.currentTarget);
            else if (canListen) listen(audio);
            else generate(event.currentTarget);
          }}>
          {problem ? <ExclamationTriangleIcon aria-hidden /> : canListen ? <TriangleRightIcon aria-hidden /> : <ReloadIcon aria-hidden className={pending ? 'animate-spin motion-reduce:animate-none' : ''} />}{primaryLabel}
        </Button>
      </PopoverTrigger>
      {playingAudio && <PopoverContent aria-label="配音试听进度" className="w-fit p-1.5"
        onEscapeKeyDown={() => { restoreAfterPlayer.current = true; }}
        onCloseAutoFocus={event => {
          if (restoreAfterPlayer.current && primary.current?.disabled) { event.preventDefault(); trigger.current?.focus(); }
          restoreAfterPlayer.current = false;
        }}>
        <Listening key={playingAudio.taskId} player={player} playing={playing === playingAudio.taskId} toggle={() => listen(playingAudio)}
          stop={() => { restoreAfterPlayer.current = true; stop(); }} />
      </PopoverContent>}
    </Popover>
    <DropdownMenu modal={false} onOpenChange={open => { if (open) handoff.current = false; }}>
      <DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" size="xs" className="size-7 p-0" data-speech-more data-row-entry="speech-menu" aria-label={`片段 ${segment.order} 配音更多操作`}><ChevronDownIcon aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={`片段 ${segment.order} 配音操作`} onCloseAutoFocus={event => { if (handoff.current) event.preventDefault(); }} onClick={event => event.stopPropagation()}>
        <DropdownMenuItem data-speech-generate aria-label="重新生成" aria-description={actions.generate.reason || undefined} disabled={!actions.generate.enabled} title={actions.generate.reason} onSelect={() => { if (trigger.current) { handoff.current = latest?.state === 'unknown'; generate(trigger.current); } }}>重新生成{actions.generate.reason && <span className="text-xs"> · {actions.generate.reason}</span>}</DropdownMenuItem>
        {['历史', '保留音频'].map(label => <DropdownMenuItem key={label} data-speech-history onSelect={() => { if (trigger.current) { handoff.current = true; history(trigger.current); } }}>{label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </section>;
}
