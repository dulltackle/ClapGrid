import { ChevronDownIcon, ChevronUpIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/index.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
import { panelServiceUrl } from './service-url.js';
import { SegmentSpeech, SegmentSpeechMenu } from './segment-speech.js';
import { SearchText } from './text-search.js';

type SpeechProps = Omit<ComponentProps<typeof SegmentSpeech>, 'segment' | 'generate' | 'history'> & {
  generate: (id: string) => void; history: (id: string, trigger: HTMLElement) => void;
};
type RowProps = SpeechProps & {
  data?: Segment; expandedId: string | null; toggleNote: (id: string) => void;
};

/** 文案与辅助内容分层，仍由同一文案单元格承接原有行内编辑。 */
export function SegmentRowCell({ data, query, activeId, visit, rowHeight, assets, preview, expandedId, toggleNote, generate, history, ...speech }: RowProps & {
  query: string; activeId: string | null; visit: number; rowHeight: number;
  assets: ServiceStatus['snapshot']['assets']; preview: (segment: Segment, trigger: HTMLButtonElement) => void;
}) {
  if (!data) return null;
  const asset = assets.find(asset => asset.id === data.video?.assetId);
  return <div className="flex h-full w-full min-w-0 flex-col pb-1">
    <div className="flex min-h-0 flex-1 items-center gap-4 border-0 border-b border-solid border-input/60 text-[15px]">
      <div data-segment-script className="flex h-full min-w-0 flex-1 items-center">
        <SearchText text={data.text} query={query} current={data.id === activeId} visit={visit} rowHeight={rowHeight - 44} />
      </div>
      <SegmentSpeech {...speech} segment={data} generate={() => generate(data.id)} history={trigger => history(data.id, trigger)} />
    </div>
    <div data-segment-support className="flex h-[54px] min-w-0 shrink-0 items-center gap-4">
      {asset ? <button className="h-11 w-[84px] shrink-0 cursor-pointer overflow-hidden rounded-md border border-solid border-input bg-background p-0 text-foreground hover:bg-ui-accent" aria-label={`播放 ${asset.name}`} onClick={event => preview(data, event.currentTarget)}>
        <img src={`${panelServiceUrl()}/api/media/${asset.id}/thumbnail`} alt="" className="h-full w-full object-contain" />
      </button> : <span className="flex h-11 w-[84px] shrink-0 items-center justify-center text-xs text-muted-foreground">未关联</span>}
      <Button variant="ghost" size="xs" className="block h-7 min-w-0 flex-1 truncate rounded-sm p-0 text-left text-[12px] leading-7 font-normal text-muted-foreground hover:bg-transparent hover:text-primary" data-note-summary aria-label={`${data.id === expandedId ? '收起' : '展开'}片段 ${data.order} 的画面说明`} aria-expanded={data.id === expandedId} aria-controls={data.id === expandedId ? `segment-note-${data.id}` : undefined} onClick={() => toggleNote(data.id)}>{data.visualNote || '暂无画面说明'}</Button>
    </div>
  </div>;
}

/** 固定行尾与内容层对齐；箭头和更多入口始终可达，详情在悬浮或键盘聚焦时显示。 */
export function SegmentRowActions({ data, expandedId, toggleNote, open, speech, disabled, generate, history }: RowProps & {
  open: (id: string, trigger: HTMLButtonElement) => void;
}) {
  if (!data) return null;
  const expanded = expandedId === data.id;
  return <div className="flex h-full flex-col pb-1">
    <div className="flex min-h-0 flex-1 items-center justify-end border-0 border-b border-solid border-input/60">
      <Button variant="ghost" size="xs" className="size-6 shrink-0 rounded-md p-0 text-foreground opacity-0 group-[:hover]/segment:opacity-100 focus-visible:opacity-100" data-row-details aria-label={`查看片段 ${data.order} 的详情`} title="片段详情" onClick={event => open(data.id, event.currentTarget)}><InfoCircledIcon aria-hidden /></Button>
      <Button variant="ghost" size="xs" className="size-6 shrink-0 rounded-md p-0" data-note-toggle aria-label={`${expanded ? '收起' : '展开'}片段 ${data.order} 的画面说明`} aria-expanded={expanded} aria-controls={expanded ? `segment-note-${data.id}` : undefined} onClick={() => toggleNote(data.id)}>{expanded ? <ChevronUpIcon aria-hidden className="size-4" /> : <ChevronDownIcon aria-hidden className="size-4" />}</Button>
    </div>
    <div className="flex h-[54px] shrink-0 items-center justify-end"><SegmentSpeechMenu segment={data} speech={speech} disabled={disabled} generate={() => generate(data.id)} history={trigger => history(data.id, trigger)} /></div>
  </div>;
}
