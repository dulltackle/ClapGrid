import { DragHandleDots2Icon, ChevronDownIcon, DotsHorizontalIcon, ImageIcon, PlusIcon, Cross2Icon, MinusIcon, EnterFullScreenIcon, PlayIcon, Pencil1Icon } from '@radix-ui/react-icons';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { Button, Popover, PopoverTrigger, PopoverContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/index.js';
import { segmentMaterials } from '../shared/contracts.js';
import type { ExportTask, Segment, ServiceStatus } from '../shared/contracts.js';
import { segmentRowMenu, type SegmentActions } from './segment-actions.js';
import { panelServiceUrl } from './service-url.js';
import { SegmentSpeech } from './segment-speech.js';
import type { useSegmentDrag } from './segment-drag.js';
import { MaterialDerivationDetails } from './material-derivation.js';
import { SearchText } from './text-search.js';

type SpeechProps = Omit<ComponentProps<typeof SegmentSpeech>, 'segment' | 'generate' | 'history' | 'draftText' | 'actions'> & {
  actionsFor: (segment: Segment) => SegmentActions;
  generate: (id: string) => void; history: (id: string, trigger: HTMLElement) => void;
};
type VisualProps = {
  segmentEditingBusy?: boolean;
  assets: ServiceStatus['snapshot']['assets']; preview: (assetId: string, trigger: HTMLButtonElement) => void;
  trayId: string | null; toggleTray: (id: string) => void;
  previews: ExportTask[]; composed: (task: ExportTask, trigger: HTMLButtonElement) => void;
  rename: (asset: ServiceStatus['snapshot']['assets'][number], trigger: HTMLElement) => void;
  associate: (id: string, trigger: HTMLElement, index?: number) => void; unlink: (segment: Segment, index?: number) => void;
};
type NoteProps = { expandedId: string | null; toggleNote: (id: string) => void };

export function SegmentRowCell({ data, draft, query, activeId, visit, rowHeight, editorFor, cancelEdit, generate, history, actionsFor, ...rest }: SpeechProps & VisualProps & NoteProps & {
  data?: Segment; draft?: { id: string; text: string } | null; editorFor?: (segment: Segment) => ReactNode;
  query: string; activeId: string | null; visit: number; rowHeight: number; cancelEdit?: () => void;
}) {
  if (!data) return null;
  const editor = editorFor?.(data);
  return <div data-inline-editor={editor ? '' : undefined} onKeyDown={event => {
    if (editor && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancelEdit?.(); }
  }} className="flex h-full w-full min-w-0 flex-col pb-1">
    <div className="flex min-h-0 flex-1 items-center gap-4 border-0 border-b border-solid border-input/60 text-[15px]">
      {editor || <div data-segment-script title="单击编辑口播文案" onMouseDown={event => event.preventDefault()} className="flex h-full min-w-0 flex-1 cursor-text items-start rounded-md border border-solid border-transparent pl-2 pr-[88px] transition-colors hover:bg-muted hover:inset-ring hover:inset-ring-input motion-reduce:transition-none">
        <SearchText text={data.text} query={query} current={data.id === activeId} visit={visit} rowHeight={rowHeight - 44} />
      </div>}
      <SegmentSpeech {...rest} actions={actionsFor(data)} segment={data} draftText={draft?.id === data.id ? draft.text : undefined} generate={() => generate(data.id)} history={trigger => history(data.id, trigger)} />
    </div>
    <SegmentRowSupport {...rest} data={data} actions={actionsFor(data)} />
  </div>;
}

export function SegmentRowSupport({ data, assets, preview, expandedId, toggleNote, associate, rename, unlink, actions, trayId, toggleTray, previews, composed, segmentEditingBusy }: VisualProps & NoteProps & {
  data: Segment; actions: SegmentActions;
}) {
  const trayTrigger = useRef<HTMLButtonElement>(null);
  const materials = segmentMaterials(data);
  const expanded = trayId === data.id;
  const task = previews.filter(task => task.preview?.segmentId === data.id).at(-1);
  const message = task ? task.state === 'succeeded' ? task.current ? task.preview?.subtitleIssue ?? '预览已就绪' : '预览待更新' : task.message : data.composition ? '尚未生成合成预览' : '等待 agent 编排';
  return <Popover open={expanded} onOpenChange={open => { if (open !== expanded) toggleTray(data.id); }}><div data-segment-support className="flex min-w-0 shrink-0 flex-col">
    <div className="flex h-[54px] min-w-0 items-center gap-2">
      <PopoverTrigger asChild><Button ref={trayTrigger} variant="ghost" size="xs" className="h-10 shrink-0 gap-1 px-1" title={`${expanded ? '收起' : '展开'}本句画面素材，查看或添加图片和视频`} aria-label={`片段 ${data.order} 画面素材（${materials.length}）`}>
        {materials.length ? <span className="relative block h-9 w-14" aria-hidden>
          {materials.slice(0, 2).map((assetId, index) => <span key={assetId} className={`absolute flex h-8 w-12 items-center justify-center overflow-hidden rounded border border-solid border-input bg-muted ${index === 0 ? 'left-0 top-1 z-10' : 'left-2 top-0'}`}><ImageIcon className="size-4 text-muted-foreground" /><img src={`${panelServiceUrl()}/api/media/${assetId}/thumbnail`} alt="" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true; }} /></span>)}
          <span className="absolute bottom-0 right-0 z-20 rounded border border-solid border-input bg-background px-1 text-[10px] leading-4 text-foreground">{materials.length}</span>
        </span> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><ImageIcon aria-hidden />添加素材</span>}
        <ChevronDownIcon aria-hidden className={expanded ? 'rotate-180' : ''} />
      </Button></PopoverTrigger>
      <Button variant="ghost" size="xs" className="min-w-0 flex-1 justify-start overflow-hidden px-1 text-left text-[12px] font-normal text-muted-foreground" title={`${data.id === expandedId ? '收起' : '展开'}画面说明：查看本句的画面内容与拍摄建议`} data-note-summary aria-label={`${data.id === expandedId ? '收起' : '展开'}片段 ${data.order} 的画面说明`} aria-expanded={data.id === expandedId} aria-controls={data.id === expandedId ? `segment-note-${data.id}` : undefined} onClick={() => toggleNote(data.id)}><span className="shrink-0 font-medium">画面说明</span><ChevronDownIcon aria-hidden className={`shrink-0 ${data.id === expandedId ? 'rotate-180' : ''}`} /><span className="truncate">{data.visualNote || '暂无说明，点击展开'}</span></Button>
    </div>
    <PopoverContent aria-label={`片段 ${data.order} 素材面板`} className="w-[min(452px,calc(100vw-24px))] rounded-xl p-0"><section id={`materials-${data.id}`} aria-label={`片段 ${data.order} 的画面素材`} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 px-4 pb-3 pt-3">
        <span className="mr-auto text-sm font-medium">画面素材 <span className="ml-1 text-xs font-normal text-muted-foreground">{materials.length}</span></span>
        <Button variant="ghost" size="xs" className={`text-primary ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={!actions.associate.enabled} title={actions.associate.reason} aria-label={`为片段 ${data.order} 添加画面素材`} onClick={event => associate(data.id, event.currentTarget, materials.length)}><PlusIcon aria-hidden />添加</Button>
        <Button variant="ghost" size="xs" className="size-6 p-0 text-muted-foreground" aria-label="关闭素材面板" onClick={() => toggleTray(data.id)}><Cross2Icon aria-hidden /></Button>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 px-4 pb-4" tabIndex={0} aria-label="本句素材列表">
        {!materials.length && <span className="col-span-2 py-6 text-center text-xs text-muted-foreground">添加本句需要的图片或视频，编排交给 agent。</span>}
        {materials.map((assetId, index) => {
          const asset = assets.find(asset => asset.id === assetId);
          const image = asset?.kind === 'image'; const name = asset?.name ?? '缺失素材';
          return <div key={`${index}-${assetId}`} className="min-w-0">
            <button className="relative block aspect-video w-full cursor-pointer overflow-hidden rounded-md border-0 bg-muted p-0" aria-label={`${image ? '查看' : '播放'}原件 ${name}`} onClick={event => preview(assetId, event.currentTarget)}><img src={`${panelServiceUrl()}/api/media/${assetId}/thumbnail`} alt="" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-background px-1 py-0.5 text-[10px] text-foreground"><EnterFullScreenIcon aria-hidden className="size-3" />原件</span></button>
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <button type="button" className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-left text-xs hover:bg-ui-accent disabled:cursor-default ${segmentEditingBusy && asset ? 'disabled:opacity-100' : 'disabled:opacity-50'}`} disabled={!asset || !actions.associate.enabled} aria-label={`重命名素材 ${name}`} title={`重命名：${name}`} onClick={event => asset && rename(asset, event.currentTarget)}><span className="min-w-0 flex-1 truncate">{name}</span><Pencil1Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" /></button>
              <Button variant="ghost" size="xs" className={`size-6 shrink-0 p-0 text-muted-foreground ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={!actions.associate.enabled} aria-label={`移出本句 ${name}`} title="移出本句" onClick={() => { trayTrigger.current?.focus(); unlink(data, index); }}><MinusIcon aria-hidden /></Button>
            </div>
            <div className="text-[11px] text-muted-foreground">{image ? '图片' : '视频'}{asset?.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}</div>
            {asset?.derivation && <MaterialDerivationDetails derivation={asset.derivation} assets={assets} onOpen={preview} />}
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-input bg-muted/50 px-4 py-3">
        <span role="status" className="min-w-0 truncate text-xs text-muted-foreground" title={message}>{message}</span>
        <Button variant="outline" size="xs" disabled={!task?.current || !task.output} onClick={event => task && composed(task, event.currentTarget)}><PlayIcon aria-hidden />片段合成预览</Button>
      </div>
    </section></PopoverContent>
  </div></Popover>;
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

/** 稳定的渲染组件让状态刷新保留序号入口的 DOM 与键盘焦点。 */
export function SegmentOrderCell({ data, actionsFor, drag, segmentEditingBusy }: {
  data?: Segment; actionsFor: (segment: Segment) => SegmentActions; segmentEditingBusy?: boolean;
  drag: Pick<ReturnType<typeof useSegmentDrag>, 'keyboard' | 'start'>;
}) {
  if (!data) return null;
  return <span className="flex h-full items-center justify-center"><button className={`group/order relative flex h-7 w-full min-w-7 cursor-grab touch-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-foreground hover:bg-ui-accent active:cursor-grabbing disabled:cursor-default ${segmentEditingBusy ? 'disabled:opacity-100' : 'disabled:opacity-30'}`} aria-label={`拖动片段 ${data.order}`} disabled={!actionsFor(data).drag.enabled} title={actionsFor(data).drag.reason || '拖动序号调整片段顺序'} onKeyDown={event => drag.keyboard(event, data.id)} onPointerDownCapture={event => drag.start(event, data.id)} onClick={event => event.stopPropagation()}><span data-segment-order className="tabular-nums group-hover/order:invisible group-focus-visible/order:invisible group-aria-selected/segment:font-medium group-aria-selected/segment:text-primary">{data.order}</span><DragHandleDots2Icon aria-hidden className="absolute size-4 opacity-0 group-hover/order:opacity-100 group-focus-visible/order:opacity-100" /></button></span>;
}
