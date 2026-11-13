import { DragHandleDots2Icon, ImageIcon, PlusIcon, Cross2Icon, MinusIcon, EnterFullScreenIcon, PlayIcon, Pencil1Icon } from '@radix-ui/react-icons';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ICellRendererParams } from 'ag-grid-community';
import { Button, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/index.js';
import { segmentMaterials } from '../shared/contracts.js';
import type { ExportTask, Segment, ServiceStatus } from '../shared/contracts.js';
import type { SegmentActions } from './segment-actions.js';
import { panelServiceUrl } from './service-url.js';
import type { useSegmentDrag } from './segment-drag.js';
import { MaterialDerivationDetails } from './material-derivation.js';
import { SearchText } from './text-search.js';

type VisualProps = {
  segmentEditingBusy?: boolean;
  assets: ServiceStatus['snapshot']['assets']; preview: (assetId: string, trigger: HTMLButtonElement) => void;
  trayId: string | null; toggleTray: (id: string) => void;
  previews: ExportTask[]; composed: (task: ExportTask, trigger: HTMLButtonElement) => void;
  rename: (asset: ServiceStatus['snapshot']['assets'][number], trigger: HTMLElement) => void;
  associate: (id: string, trigger: HTMLElement) => void; unlink: (segment: Segment, index?: number) => void;
};

export function SegmentScriptCell({ data, query, activeId, editorFor, speechLock, api, node, eGridCell }:
  Pick<ICellRendererParams<Segment>, 'data' | 'api' | 'node' | 'eGridCell'> & {
    editorFor: (segment: Segment) => ReactNode; query: string; activeId: string | null; speechLock: string;
  }) {
  const editor = data ? editorFor(data) : null;
  const editing = !!editor;
  const editorBody = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = editorBody.current;
    if (!editing || !body) return;
    // 自动行高会延后重排；编辑行在绘制前同步位置，避免操作栏先伸到下一行。
    const syncHeight = () => {
      const cell = getComputedStyle(eGridCell);
      const height = body.offsetHeight + parseFloat(cell.paddingTop) + parseFloat(cell.paddingBottom)
        + parseFloat(cell.borderTopWidth) + parseFloat(cell.borderBottomWidth);
      if (height === node.rowHeight) return;
      node.setRowHeight(height);
      api.onRowHeightChanged();
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(body);
    return () => observer.disconnect();
  }, [editing, api, node, eGridCell]);
  if (!data) return null;
  if (editor) return <div ref={editorBody} data-inline-editor className="w-full min-w-0 py-1">{editor}</div>;
  return <div className="w-full min-w-0">
    <div data-segment-script title={speechLock || '单击编辑口播文案'} aria-disabled={speechLock ? true : undefined} onMouseDown={event => event.preventDefault()}
      className={`min-h-12 max-[720px]:min-h-[70px] max-[480px]:min-h-[80px] min-[601px]:max-[640px]:min-h-[80px] rounded-md px-1 py-3 text-base ${speechLock ? '' : 'cursor-text hover:bg-muted hover:inset-ring hover:inset-ring-input'}`}>
      <SearchText text={data.text} query={query} current={data.id === activeId} />
    </div>
  </div>;
}

export function SegmentMaterialsCell({ data, assets, preview, associate, rename, unlink, actionsFor, trayId, toggleTray, previews, composed, segmentEditingBusy }: VisualProps & {
  data?: Segment; actionsFor: (segment: Segment) => SegmentActions;
}) {
  const trayTrigger = useRef<HTMLButtonElement>(null);
  if (!data) return null;
  const actions = actionsFor(data);
  const materials = segmentMaterials(data);
  const expanded = trayId === data.id;
  const tasks = previews.filter(task => task.preview?.segmentId === data.id);
  const task = tasks.at(-1);
  const result = tasks.filter(task => task.state === 'succeeded' && task.output).at(-1);
  const ready = result?.current ? result : undefined;
  const message = task ? task.state === 'succeeded' ? ready ? ready.preview?.subtitleIssue ?? '预览已就绪' : '预览待更新' : task.message : data.composition ? '尚未生成合成预览' : '等待 agent 编排';
  return <Popover open={expanded} onOpenChange={open => { if (open !== expanded) toggleTray(data.id); }}><div data-segment-support className="flex items-center gap-0.5 pt-2">
    <PopoverTrigger asChild><Button ref={trayTrigger} data-row-entry="materials" variant="ghost" size="sm" className="min-w-8 px-1 text-muted-foreground max-[600px]:px-0.5" title="查看或添加本句画面素材" aria-label={`片段 ${data.order} 画面素材（${materials.length}）`}>
      {materials.length ? <span className="flex items-center gap-1.5 max-[600px]:gap-0.5" aria-hidden>
        <span className="flex gap-0.5">{materials.slice(0, 3).map((assetId, index) => <span key={`${index}-${assetId}`} className="relative flex size-6 items-center justify-center overflow-hidden rounded-sm border border-solid border-input bg-muted max-[600px]:h-4 max-[600px]:w-3"><ImageIcon className="size-3 text-muted-foreground" /><img src={`${panelServiceUrl()}/api/media/${assetId}/thumbnail`} alt="" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true; }} /></span>)}</span>
        <span className="text-xs tabular-nums">{materials.length}</span>
      </span> : <span className="flex items-center gap-1 text-xs"><PlusIcon aria-hidden />素材</span>}
    </Button></PopoverTrigger>
    {ready ? <Button variant="ghost" size="icon-sm" data-row-entry="composed-preview" className="text-ok hover:text-ok max-[600px]:hidden" title="片段合成预览已就绪" aria-label={`播放片段 ${data.order} 合成预览，已就绪`} onClick={event => composed(ready, event.currentTarget)}><PlayIcon aria-hidden /></Button>
      : result && <span className="pointer-events-none rounded bg-warning-surface px-0.5 text-xs leading-4 text-warning max-[600px]:hidden">待更新</span>}
    <PopoverContent aria-label={`片段 ${data.order} 素材面板`} className="w-[min(452px,calc(100vw-24px))] rounded-xl p-0"><section id={`materials-${data.id}`} aria-label={`片段 ${data.order} 的画面素材`} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 px-4 pb-3 pt-3">
        <span className="mr-auto text-sm font-medium">画面素材 <span className="ml-1 text-xs font-normal text-muted-foreground">{materials.length}</span></span>
        <Button variant="ghost" size="sm" className={`text-primary ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={!actions.associate.enabled} title={actions.associate.reason} aria-label={`为片段 ${data.order} 添加画面素材`} onClick={event => associate(data.id, event.currentTarget)}><PlusIcon aria-hidden />添加</Button>
        <Button variant="ghost" size="sm" className="size-8 p-0 text-muted-foreground" aria-label="关闭素材面板" onClick={() => toggleTray(data.id)}><Cross2Icon aria-hidden /></Button>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 px-4 pb-4" tabIndex={0} aria-label="本句素材列表">
        {!materials.length && <span className="col-span-2 py-6 text-center text-xs text-muted-foreground">添加本句需要的图片或视频，编排交给 agent。</span>}
        {materials.map((assetId, index) => {
          const asset = assets.find(asset => asset.id === assetId);
          const image = asset?.kind === 'image'; const name = asset?.name ?? '缺失素材';
          return <div key={`${index}-${assetId}`} className="min-w-0">
            <button className="relative block aspect-video w-full cursor-pointer overflow-hidden rounded-md border-0 bg-muted p-0" aria-label={`${image ? '查看' : '播放'}原件 ${name}`} onClick={event => preview(assetId, event.currentTarget)}><img src={`${panelServiceUrl()}/api/media/${assetId}/thumbnail`} alt="" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-background px-1 py-0.5 text-xs text-foreground"><EnterFullScreenIcon aria-hidden className="size-3" />原件</span></button>
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <button type="button" className={`flex min-w-0 flex-1 min-h-8 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-left text-xs hover:bg-ui-accent disabled:cursor-default ${segmentEditingBusy && asset ? 'disabled:opacity-100' : 'disabled:opacity-50'}`} disabled={!asset || !actions.associate.enabled} aria-label={`重命名素材 ${name}`} title={`重命名：${name}`} onClick={event => asset && rename(asset, event.currentTarget)}><span className="min-w-0 flex-1 truncate">{name}</span><Pencil1Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" /></button>
              <Button variant="ghost" size="sm" className={`size-8 shrink-0 p-0 text-muted-foreground ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={!actions.associate.enabled} aria-label={`移出本句 ${name}`} title="移出本句" onClick={() => { trayTrigger.current?.focus(); unlink(data, index); }}><MinusIcon aria-hidden /></Button>
            </div>
            <div className="text-xs text-muted-foreground">{image ? '图片' : '视频'}{asset?.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}</div>
            {asset?.derivation && <MaterialDerivationDetails derivation={asset.derivation} assets={assets} onOpen={preview} />}
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-input bg-muted/50 px-4 py-3">
        <span role="status" className="min-w-0 truncate text-xs text-muted-foreground" title={message}>{message}</span>
        <Button variant="outline" size="sm" disabled={!ready} onClick={event => ready && composed(ready, event.currentTarget)}><PlayIcon aria-hidden />片段合成预览</Button>
      </div>
    </section></PopoverContent>
  </div></Popover>;
}

/** 稳定的渲染组件让状态刷新保留序号入口的 DOM 与键盘焦点。 */
export function SegmentOrderCell({ data, actionsFor, drag, segmentEditingBusy }: {
  data?: Segment; actionsFor: (segment: Segment) => SegmentActions; segmentEditingBusy?: boolean;
  drag: Pick<ReturnType<typeof useSegmentDrag>, 'keyboard' | 'start'>;
}) {
  if (!data) return null;
  return <span className="flex justify-center pt-2"><button className={`group/order relative flex h-8 w-full min-w-8 cursor-grab touch-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-foreground hover:bg-ui-accent active:cursor-grabbing disabled:cursor-default ${segmentEditingBusy ? 'disabled:opacity-100' : 'disabled:opacity-30'}`} aria-label={`拖动片段 ${data.order}`} disabled={!actionsFor(data).drag.enabled} title={actionsFor(data).drag.reason || '拖动序号调整片段顺序'} onKeyDown={event => drag.keyboard(event, data.id)} onPointerDownCapture={event => drag.start(event, data.id)} onClick={event => event.stopPropagation()}><span data-segment-order className="tabular-nums group-hover/order:invisible group-focus-visible/order:invisible group-aria-selected/segment:font-medium group-aria-selected/segment:text-primary">{data.order}</span><DragHandleDots2Icon aria-hidden className="absolute size-4 opacity-0 group-hover/order:opacity-100 group-focus-visible/order:opacity-100" /></button></span>;
}
