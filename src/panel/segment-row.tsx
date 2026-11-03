import { ChevronDownIcon, DotsHorizontalIcon } from '@radix-ui/react-icons';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/index.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
import { segmentRowMenu, type SegmentActions } from './segment-actions.js';
import { panelServiceUrl } from './service-url.js';
import { SegmentSpeech } from './segment-speech.js';
import { SearchText } from './text-search.js';

type SpeechProps = Omit<ComponentProps<typeof SegmentSpeech>, 'segment' | 'generate' | 'history' | 'draftText' | 'actions'> & {
  actionsFor: (segment: Segment) => SegmentActions;
  generate: (id: string) => void; history: (id: string, trigger: HTMLElement) => void;
};
type VisualProps = {
  assets: ServiceStatus['snapshot']['assets']; preview: (segment: Segment, trigger: HTMLButtonElement) => void;
  associate: (id: string, trigger: HTMLElement) => void; unlink: (segment: Segment) => void;
};
type NoteProps = { expandedId: string | null; toggleNote: (id: string) => void };

export function SegmentRowCell({ data, draft, query, activeId, visit, rowHeight, editorFor, generate, history, actionsFor, ...rest }: SpeechProps & VisualProps & NoteProps & {
  data?: Segment; draft?: { id: string; text: string } | null; editorFor?: (segment: Segment) => ReactNode;
  query: string; activeId: string | null; visit: number; rowHeight: number;
}) {
  if (!data) return null;
  const editor = editorFor?.(data);
  if (editor) return editor;
  return <div className="flex h-full w-full min-w-0 flex-col pb-1">
    <div className="flex min-h-0 flex-1 items-center gap-4 border-0 border-b border-solid border-input/60 text-[15px]">
      <div data-segment-script className="flex h-full min-w-0 flex-1 items-center">
        <SearchText text={data.text} query={query} current={data.id === activeId} visit={visit} rowHeight={rowHeight - 44} />
      </div>
      <SegmentSpeech {...rest} actions={actionsFor(data)} segment={data} draftText={draft?.id === data.id ? draft.text : undefined} generate={() => generate(data.id)} history={trigger => history(data.id, trigger)} />
    </div>
    <SegmentRowSupport {...rest} data={data} actions={actionsFor(data)} />
  </div>;
}

export function SegmentRowSupport({ data, assets, preview, expandedId, toggleNote, associate, unlink, actions }: VisualProps & NoteProps & {
  data: Segment; actions: SegmentActions;
}) {
  const visualTrigger = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);
  const asset = assets.find(asset => asset.id === data.video?.assetId);
  return <div data-segment-support className="flex h-[54px] min-w-0 shrink-0 items-center gap-2">
    {asset ? <>
      <button className="h-11 w-[84px] shrink-0 cursor-pointer overflow-hidden rounded-md border border-solid border-input bg-background p-0 text-foreground hover:bg-ui-accent" aria-label={`播放 ${asset.name}`} onClick={event => preview(data, event.currentTarget)}>
        <img src={`${panelServiceUrl()}/api/media/${asset.id}/thumbnail`} alt="" className="h-full w-full object-contain" />
      </button>
      <DropdownMenu modal={false} onOpenChange={open => { if (open) handoff.current = false; }}>
        <DropdownMenuTrigger asChild><Button ref={visualTrigger} variant="ghost" size="xs" aria-label={`片段 ${data.order} 画面操作`}><ChevronDownIcon aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={event => { if (handoff.current) event.preventDefault(); }} onClick={event => event.stopPropagation()}>
          <DropdownMenuItem disabled={!actions.changeVisual.enabled} title={actions.changeVisual.reason} onSelect={() => { if (visualTrigger.current) { handoff.current = true; associate(data.id, visualTrigger.current); } }}>更改</DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.unlink.enabled} title={actions.unlink.reason} onSelect={() => unlink(data)}>解除关联{actions.unlink.reason && <span className="text-xs"> · {actions.unlink.reason}</span>}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </> : <Button variant="outline" size="xs" disabled={!actions.associate.enabled} title={actions.associate.reason} onClick={event => associate(data.id, event.currentTarget)}>关联画面</Button>}
    <Button variant="ghost" size="xs" className="flex h-7 min-w-0 flex-1 justify-start gap-1 overflow-hidden rounded-sm p-0 text-left text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-primary" data-note-summary aria-label={`${data.id === expandedId ? '收起' : '展开'}片段 ${data.order} 的画面说明`} aria-expanded={data.id === expandedId} aria-controls={data.id === expandedId ? `segment-note-${data.id}` : undefined} onClick={() => toggleNote(data.id)}><ChevronDownIcon aria-hidden className={`shrink-0 ${data.id === expandedId ? 'rotate-180' : ''}`} /><span className="truncate">{data.visualNote || '暂无画面说明'}</span></Button>
  </div>;
}

/** 常驻本行菜单与右键共用范围快照及动作模型。 */
export function SegmentRowActions({ data, actionsFor, open, remove, insert, changed, menuActions, restore }: {
  data?: Segment; actionsFor: (segment: Segment) => SegmentActions;
  open: (segment: Segment, trigger: HTMLElement) => void; remove: () => void; insert: (placement: 'before' | 'after') => void; changed: (open: boolean) => void; menuActions?: SegmentActions; restore: () => boolean;
}) {
  if (!data) return null;
  const actions = menuActions ?? actionsFor(data);
  const menu = segmentRowMenu(actions, data.order);
  return <div className="flex h-full items-center justify-center">
    <DropdownMenu modal={false} onOpenChange={changed}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="size-8 p-0" aria-label={`片段 ${data.order} 本行菜单`} onPointerDown={event => open(data, event.currentTarget)} onKeyDown={event => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) open(data, event.currentTarget); }}><DotsHorizontalIcon aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={event => { if (!restore()) event.preventDefault(); }} align="end" aria-label="口播片段操作" onClick={event => event.stopPropagation()}>
        <div className="px-2 py-1 text-xs text-muted-foreground">{menu.scope}</div>
        {menu.items.map(item => <DropdownMenuItem key={item.key} aria-label={item.label} aria-description={item.reason || undefined} disabled={!item.enabled} title={item.reason} onSelect={() => item.key === 'delete' ? remove() : insert(item.key)}>{item.label}{item.reason && <span className="text-xs text-muted-foreground"> · {item.reason}</span>}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
