import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUpIcon } from '@radix-ui/react-icons';
import { Button } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';

type Row = { element: HTMLElement; id: string };

function ExpandedNote({ segment, mainHeight, width, left, onHeight, onCollapse, onOpen }: {
  segment: Segment; mainHeight: number; width: number; left: number; onHeight: (height: number) => void;
  onCollapse: () => void; onOpen: (id: string, trigger: HTMLElement, field?: 'visualNote') => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    // 说明随列宽和原文换行；真实测量回交 AG Grid，避免覆盖下一条虚拟行。
    const measure = () => onHeight(Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [onHeight, segment.id]);
  return <div ref={content} id={`segment-note-${segment.id}`} role="region" aria-label={`片段 ${segment.order} 画面说明`} className="pointer-events-auto absolute z-10 bg-background px-3 pb-3" style={{ top: mainHeight, width, left }} onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCollapse(); }
  }}>
    <div className="rounded-md bg-primary/5 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium">
        <span className="mr-auto">画面说明</span>
        <Button variant="ghost" size="xs" className="h-6 text-xs text-muted-foreground" data-row-details onClick={event => onOpen(segment.id, event.currentTarget)}>编辑与片段详情</Button>
        <Button variant="ghost" size="xs" className="h-6 gap-1 text-xs text-primary" onClick={onCollapse}>收起<ChevronUpIcon aria-hidden /></Button>
      </div>
      <p data-note-original tabIndex={0} aria-label="画面说明原文" title="双击编辑画面说明，或按 Enter / F2" onDoubleClick={event => { event.stopPropagation(); onOpen(segment.id, event.currentTarget, 'visualNote'); }} onKeyDown={event => {
        if (['Enter', 'F2'].includes(event.key) && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onOpen(segment.id, event.currentTarget, 'visualNote'); }
      }} className="m-0 max-h-[88px] cursor-text overflow-y-auto whitespace-pre-wrap wrap-anywhere text-[13px] leading-[22px] text-muted-foreground">{segment.visualNote || '暂无画面说明'}</p>
    </div>
  </div>;
}

/** 仅把展开内容挂在真实虚拟行上；选择、顺序和行位置仍由 AG Grid 管理。 */
export function SegmentRowDetails({ element, segments, expandedId, mainHeight, onHeight, onCollapse, onOpen }: {
  element: RefObject<HTMLDivElement | null>; segments: Segment[]; expandedId: string | null; mainHeight: number;
  onHeight: (height: number) => void; onCollapse: () => void;
  onOpen: (id: string, trigger: HTMLElement, field?: 'visualNote') => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [width, setWidth] = useState(0);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const root = element.current;
    if (!root) return;
    const measure = () => {
      const viewport = root.querySelector<HTMLElement>('.ag-grid-viewport');
      setWidth(Math.max(0, viewport?.clientWidth ?? root.clientWidth - 2));
      setLeft(viewport?.scrollLeft ?? 0);
    };
    const observer = new ResizeObserver(measure); observer.observe(root); root.addEventListener('scroll', measure, true); measure();
    return () => { observer.disconnect(); root.removeEventListener('scroll', measure, true); };
  }, [element]);
  useEffect(() => {
    const root = element.current;
    if (!root) return;
    const sync = () => {
      const next = [...root.querySelectorAll<HTMLElement>('.ag-row[row-id]')].map(element => ({ element, id: element.getAttribute('row-id')! }));
      setRows(previous => previous.length === next.length && previous.every((row, index) => row.element === next[index]!.element && row.id === next[index]!.id) ? previous : next);
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['row-id'] });
    sync(); return () => observer.disconnect();
  }, [element]);
  const row = rows.find(row => row.id === expandedId);
  const segment = segments.find(segment => segment.id === expandedId);
  const collapse = () => {
    const toggle = row?.element.querySelector<HTMLButtonElement>('[data-note-toggle]');
    onCollapse(); toggle?.focus({ preventScroll: true });
  };
  return row && segment ? createPortal(<ExpandedNote segment={segment} width={width} left={left} mainHeight={mainHeight} onHeight={onHeight} onCollapse={collapse} onOpen={onOpen} />, row.element, row.id) : null;
}
