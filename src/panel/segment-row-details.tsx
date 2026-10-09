import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';

type Row = { element: HTMLElement; id: string };

/** 将入口挂在真实虚拟行上；CSS sticky 保持横向位置，不另算行高或滚动坐标。 */
export function SegmentRowDetails({ element, segments, onOpen }: {
  element: RefObject<HTMLDivElement | null>;
  segments: Segment[];
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const root = element.current;
    if (!root) return;
    const sync = () => {
      const next = [...root.querySelectorAll<HTMLElement>('.ag-row[row-id]')].map(element => ({ element, id: element.getAttribute('row-id')! }));
      setRows(previous => previous.length === next.length && previous.every((row, index) => row.element === next[index]!.element && row.id === next[index]!.id) ? previous : next);
    };
    // AG Grid 拥有虚拟行的创建、移除和身份；只同步挂载目标，不改动其单元格。
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['row-id'] });
    sync();
    return () => observer.disconnect();
  }, [element]);
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  return rows.map(row => {
    const segment = byId.get(row.id);
    if (!segment) return null;
    return createPortal(<div className="segment-row-details pointer-events-none sticky z-10 h-full w-0 shrink-0" role="presentation">
      <Button variant="outline" size="xs" className="pointer-events-auto absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-background p-0 shadow-sm" data-row-details aria-label={`查看片段 ${segment.order} 的详情`} title="片段详情"
        onClick={event => { event.stopPropagation(); onOpen(segment.id, event.currentTarget); }}
        onKeyDown={event => { if (['Enter', ' '].includes(event.key)) event.stopPropagation(); }}>›</Button>
    </div>, row.element, row.id);
  });
}
