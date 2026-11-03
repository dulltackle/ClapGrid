import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../shared/contracts.js';
import { segmentTargets } from './segment-interaction.js';

type Options = {
  segments: Segment[]; disabled: boolean; grid: RefObject<GridApi<Segment> | null>;
  element: RefObject<HTMLDivElement | null>;
  submit: (expectedIds: string[], ids: string[]) => void;
  reject: (message: string) => void;
};
type Target = { id: string; after: boolean; top: number; left: number; width: number };

/** 指针拖拽只产生完整顺序请求；项目内容与修改权仍由现有保存入口裁决。 */
export function useSegmentDrag(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [line, setLine] = useState<Target | null>(null);
  const [count, setCount] = useState(0);
  const keyboardMove = useRef<{ id: string; expected: string[]; moving: string[]; remaining: string[]; index: number } | null>(null);
  const [keyboardHint, setKeyboardHint] = useState('');
  const keyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.nativeEvent.isComposing || latest.current.disabled || !['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { keyboardMove.current = null; setKeyboardHint(''); return; }
    let move = keyboardMove.current;
    if (!move || move.id !== id) {
      if (!['Enter', ' '].includes(event.key)) return;
      const { segments, grid } = latest.current;
      const moving = segmentTargets(segments, grid.current?.getSelectedRows().map(item => item.id) ?? [], id).map(item => item.id);
      const expected = segments.map(item => item.id);
      const remaining = expected.filter(value => !moving.includes(value));
      move = { id, moving, expected, remaining, index: expected.slice(0, expected.indexOf(moving[0]!)).filter(value => !moving.includes(value)).length };
      keyboardMove.current = move;
    } else if (['Enter', ' '].includes(event.key)) {
      keyboardMove.current = null; setKeyboardHint('');
      if (latest.current.segments.map(item => item.id).join('\0') !== move.expected.join('\0')) { latest.current.reject('项目顺序已变化，请重新移动。'); return; }
      const ids = [...move.remaining]; ids.splice(move.index, 0, ...move.moving);
      if (ids.join('\0') !== move.expected.join('\0')) latest.current.submit(move.expected, ids);
      return;
    } else move.index = Math.max(0, Math.min(move.remaining.length, move.index + (event.key === 'ArrowDown' ? 1 : -1)));
    setKeyboardHint(`移动 ${move.moving.length} 条到第 ${move.index + 1} 位；方向键定位，Enter 确认，Esc 取消`);
  };
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const start = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || latest.current.disabled) return;
    event.preventDefault(); event.stopPropagation();
    cancel.current?.();
    const { grid, segments, element } = latest.current;
    const api = grid.current;
    if (!api) return;
    const selected = new Set(segmentTargets(segments, api.getSelectedRows().map(segment => segment.id), id).map(segment => segment.id));
    const expectedIds = segments.map(segment => segment.id);
    const moving = expectedIds.filter(value => selected.has(value));
    let target: Target | null = null;
    let active = false;
    let x = event.clientX, y = event.clientY;
    const origin = { x, y };
    const update = () => {
      if (!active) return;
      const viewport = element.current?.querySelector<HTMLElement>('.ag-grid-viewport');
      const bounds = viewport?.getBoundingClientRect();
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.ag-row[row-id]');
      if (!row || !element.current?.contains(row) || !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        target = null; setLine(null); return;
      }
      const rect = row.getBoundingClientRect();
      target = { id: row.getAttribute('row-id')!, after: y >= rect.top + rect.height / 2,
        top: y >= rect.top + rect.height / 2 ? rect.bottom : rect.top, left: bounds.left, width: bounds.width };
      setCount(moving.length);
      const next = target;
      setLine(previous => previous?.id === next.id && previous.after === next.after
        && previous.top === next.top && previous.left === next.left && previous.width === next.width ? previous : next);
    };
    const move = (pointer: globalThis.PointerEvent) => {
      x = pointer.clientX; y = pointer.clientY;
      active ||= Math.hypot(x - origin.x, y - origin.y) >= 4;
      update();
    };
    let frame = 0;
    const scroll = () => {
      const viewport = element.current?.querySelector<HTMLElement>('.ag-grid-viewport');
      const bounds = viewport?.getBoundingClientRect();
      if (active && viewport && bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        const amount = y < bounds.top + 32 ? -12 : y > bounds.bottom - 32 ? 12 : 0;
        if (amount) viewport.scrollTop += amount;
      }
      // 虚拟行可能在 scroll 事件之后才挂载，静止指针也需在后续帧重新命中。
      if (active) update();
      frame = requestAnimationFrame(scroll);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', cleanup); window.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', update, true); window.removeEventListener('blur', cleanup); cancelAnimationFrame(frame); setLine(null); cancel.current = null;
    };
    const end = (pointer: globalThis.PointerEvent) => {
      x = pointer.clientX; y = pointer.clientY; update();
      const destination = target;
      cleanup();
      if (!active || !destination) return;
      const current = latest.current;
      if (current.disabled) { current.reject('项目正在编辑、保存或执行任务，拖拽未提交。请结束占用后重新拖拽。'); return; }
      if (current.segments.map(segment => segment.id).join('\0') !== expectedIds.join('\0')) {
        current.reject('项目顺序已变化，拖拽未提交。请核对最新顺序后重新拖拽。'); return;
      }
      if (selected.has(destination.id)) return;
      const remaining = expectedIds.filter(value => !selected.has(value));
      const index = remaining.indexOf(destination.id);
      if (index < 0) { current.reject('目标口播片段已不存在，拖拽未提交。'); return; }
      remaining.splice(index + Number(destination.after), 0, ...moving);
      if (remaining.join('\0') !== expectedIds.join('\0')) current.submit(expectedIds, remaining);
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); cleanup(); }
    };
    cancel.current = cleanup;
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', cleanup); window.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', update, true); window.addEventListener('blur', cleanup); frame = requestAnimationFrame(scroll);
  };
  return { start, keyboard, indicator: <>{keyboardHint && <div role="status" className="pointer-events-none absolute bottom-16 left-4 z-50 rounded-md bg-background p-2 text-xs shadow">{keyboardHint}</div>}{line && <div className="pointer-events-none fixed z-100 h-[3px] bg-[var(--color-accent)]" aria-label="口播片段插入位置" data-target-id={line.id} data-placement={line.after ? 'after' : 'before'} style={{ top: line.top, left: line.left, width: line.width }}><span className="absolute bottom-1 left-2 rounded bg-background px-2 py-1 text-xs text-foreground shadow" role="status">移动 {count} 条</span></div>}</> };
}
