import { flushSync } from 'react-dom';
import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../shared/contracts.js';

type Grid = () => GridApi<Segment> | null;
type ElementRef = () => HTMLElement | null;
type Destination = { id: string; column?: string; details?: boolean };
type Origin = Partial<Destination> & { index: number; trigger?: HTMLElement; parent?: HTMLElement };
export type FocusIntent = { valid: () => boolean };
export type FocusReturn = (() => void) & { cancel: () => void };
type ReturnOptions = { fallback?: 'segment' | 'menu'; intent?: FocusIntent };

const layers = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
  .filter(layer => layer.dataset.state !== 'closed' && available(layer));
const available = (element: HTMLElement | null | undefined): element is HTMLElement => !!element?.isConnected
  && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]')
  && !!element.getClientRects().length && getComputedStyle(element).visibility === 'visible';
const focus = (element: HTMLElement | null | undefined) => {
  if (!available(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
};

/** 片段流程的来源独立于待执行返回；用户新操作只取消旧意图，不删除父流程来源。 */
export function segmentFocusCoordinator(grid: Grid, fallback: { search: ElementRef; table: ElementRef; more: ElementRef }) {
  let epoch = 0;
  const preparations = new WeakMap<() => void, () => void>();
  let pending: (() => void) | undefined;
  const cancelPending = () => { epoch++; pending?.(); pending = undefined; };
  const intent = (): FocusIntent => { const current = epoch; return { valid: () => epoch === current }; };
  const listen = () => {
    // 不观察控件 focus/blur 和普通 scroll：卸载、轮询、恢复自身也会产生这些事件。
    const events = ['pointerdown', 'keydown', 'beforeinput', 'input', 'wheel', 'touchmove'] as const;
    for (const event of events) document.addEventListener(event, cancelPending, true);
    window.addEventListener('blur', cancelPending);
    window.addEventListener('pagehide', cancelPending);
    document.addEventListener('visibilitychange', cancelPending);
    return () => {
      cancelPending();
      for (const event of events) document.removeEventListener(event, cancelPending, true);
      window.removeEventListener('blur', cancelPending);
      window.removeEventListener('pagehide', cancelPending);
      document.removeEventListener('visibilitychange', cancelPending);
    };
  };
  const source = (origin: Origin, options: ReturnOptions): FocusReturn => {
    let ended = false;
    let closingIntent: FocusIntent | undefined;
    let stop: (() => void) | undefined;
    const restore = (() => {
      if (ended) return;
      ended = true;
      if ((closingIntent && !closingIntent.valid()) || (options.intent && !options.intent.valid())) return;
      pending?.();
      const current = epoch;
      const closingFocus = document.activeElement;
      let frame = 0;
      let finished = false;
      const finish = () => { finished = true; if (frame) cancelAnimationFrame(frame); if (pending === finish) pending = undefined; };
      pending = finish;
      stop = finish;
      const valid = () => !finished && epoch === current && (!options.intent || options.intent.valid());
      const pageFallback = () => {
        for (const candidate of options.fallback === 'menu' ? [fallback.more] : [fallback.search, fallback.table, fallback.more]) {
          if (focus(candidate())) break;
        }
        finish();
      };
      const attempt = (remaining: number) => {
        if (!valid()) { finish(); return; }
        const top = layers().at(-1);
        if (top) {
          // 父入口必须属于当前最上层；不可穿透到仍被其他模态层遮挡的抽屉或表格。
          if (!(origin.trigger && top.contains(origin.trigger) && focus(origin.trigger))) {
            if (!top.contains(document.activeElement) || !available(document.activeElement as HTMLElement)) focus(top);
          }
          finish(); return;
        }
        // 关闭清理后若用户已聚焦仍可用的其他入口，首次延迟帧也不能把它夺回。
        if (document.activeElement !== closingFocus && document.activeElement !== document.body
          && available(document.activeElement as HTMLElement) && !document.activeElement?.closest('.ag-root')
          && !origin.parent?.contains(document.activeElement)) { finish(); return; }
        if (origin.parent && available(origin.parent)) {
          if (!focus(origin.trigger)) focus(origin.parent);
          finish(); return;
        }
        if (!origin.id && focus(origin.trigger)) { finish(); return; }
        const api = grid();
        if (origin.id && (origin.column || origin.details) && api && !api.isDestroyed()) {
          const original = api.getRowNode(origin.id);
          const index = original?.rowIndex ?? Math.min(origin.index, api.getDisplayedRowCount() - 1);
          const row = index >= 0 ? api.getDisplayedRowAtIndex(index) : undefined;
          if (row?.id) {
            const selector = `[row-id="${CSS.escape(row.id)}"] ${origin.details ? '[data-row-details]' : `[col-id="${CSS.escape(origin.column!)}"]`}`;
            const range = api.getVerticalPixelRange();
            const top = row.rowTop ?? 0;
            if (!document.querySelector(selector) || top < range.top || top + (row.rowHeight ?? 0) > range.bottom) {
              // 滚动也是恢复的一部分，必须在执行时重新核对意图及当前显示位置。
              if (!valid()) { finish(); return; }
              flushSync(() => api.ensureIndexVisible(index));
            }
            if (origin.column && !document.querySelector(selector)) api.ensureColumnVisible(origin.column);
            if (focus(document.querySelector<HTMLElement>(selector))) {
              if (origin.column) api.setFocusedCell(index, origin.column);
              else if (origin.details) {
                // 行尾入口位于 AG Grid 单元格之外；第一次方向键交回真实表格导航。
                const entry = document.querySelector<HTMLElement>(selector)!;
                const leave = () => { entry.removeEventListener('keydown', resume); entry.removeEventListener('blur', leave); };
                const resume = (event: KeyboardEvent) => {
                  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
                  leave();
                  if (api.isDestroyed()) return;
                  const current = api.getRowNode(row.id!);
                  if (current?.rowIndex == null) return;
                  const next = Math.max(0, Math.min(api.getDisplayedRowCount() - 1, current.rowIndex + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
                  const column = api.getAllDisplayedVirtualColumns()[0]?.getColId();
                  if (!column) return;
                  event.preventDefault(); event.stopPropagation();
                  flushSync(() => api.ensureIndexVisible(next));
                  api.setFocusedCell(next, column);
                };
                entry.addEventListener('keydown', resume);
                entry.addEventListener('blur', leave, { once: true });
              }
              finish(); return;
            }
            if (remaining) { frame = requestAnimationFrame(() => attempt(remaining - 1)); return; }
          }
        }
        pageFallback();
      };
      // 让关闭、Portal 清理及虚拟行提交先完成；任何新操作都能在滚动发生前取消。
      frame = requestAnimationFrame(() => attempt(2));
    }) as FocusReturn;
    preparations.set(restore, () => { closingIntent ??= intent(); });
    restore.cancel = () => { ended = true; stop?.(); };
    return restore;
  };
  const capture = (trigger: HTMLElement, options: ReturnOptions = {}): FocusReturn => {
    cancelPending();
    const row = trigger.closest('[row-id]');
    return source({ trigger, parent: trigger.closest<HTMLElement>('[aria-label="口播片段详情"], [role="dialog"], [role="alertdialog"]') ?? undefined,
      id: row?.getAttribute('row-id') ?? undefined, index: Number(row?.getAttribute('row-index') ?? 0),
      column: trigger.closest('[col-id]')?.getAttribute('col-id') ?? undefined, details: trigger.hasAttribute('data-row-details') }, options);
  };
  const captureSegment = (destination: Destination, options: ReturnOptions = {}): FocusReturn => {
    const api = grid();
    const index = api && !api.isDestroyed() ? api.getRowNode(destination.id)?.rowIndex ?? Math.max(0, api.getDisplayedRowCount() - 1) : 0;
    return source({ ...destination, index }, options);
  };
  // 在业务已允许关闭时固定意图；Portal 稍后发来的自动焦点回调不能重新取得恢复权。
  const close = (restore: () => void, action: () => void) => { preparations.get(restore)?.(); action(); };
  return { capture, captureSegment, intent, cancelPending, listen, close };
}

/** 尚未迁移的行菜单短期保留原入口；后续工单接入页面级 coordinator 后移除。 */
export function dialogReturnFocus(trigger: HTMLElement, grid: () => GridApi<Segment> | null, fallback: () => HTMLElement | null) {
  const row = trigger.closest('[row-id]');
  const segmentId = row?.getAttribute('row-id');
  const rowIndex = Number(row?.getAttribute('row-index') ?? 0);
  const colId = trigger.closest('[col-id]')?.getAttribute('col-id');
  const rowDetails = trigger.hasAttribute('data-row-details');
  const focus = (element: HTMLElement | null | undefined) => {
    if (!element?.isConnected || element.matches(':disabled') || !element.getClientRects().length) return false;
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  };
  return function restore() {
    if (!segmentId && focus(trigger)) return;
    const api = grid();
    if (segmentId && (colId || rowDetails) && api && !api.isDestroyed()) {
      const original = api.getRowNode(segmentId);
      const index = original?.rowIndex ?? Math.min(rowIndex, api.getDisplayedRowCount() - 1);
      const target = index >= 0 ? api.getDisplayedRowAtIndex(index) : undefined;
      if (target) {
        const selector = `[row-id="${CSS.escape(target.id!)}"] ${rowDetails ? '[data-row-details]' : `[col-id="${CSS.escape(colId!)}"]`}`;
        // 缓冲行虽然有 DOM，仍可能被视口裁剪；正常返回不移动横纵位置。
        const range = api.getVerticalPixelRange();
        const top = target.rowTop ?? 0;
        if (!document.querySelector(selector) || top < range.top || top + (target.rowHeight ?? 0) > range.bottom) {
          flushSync(() => api.ensureIndexVisible(index));
        }
        if (!document.querySelector(selector)) {
          if (colId) api.ensureColumnVisible(colId);
          // React 的虚拟行可能在 ensureIndexVisible 返回后才挂载；等待该帧后再取新 DOM。
          requestAnimationFrame(() => {
            if (api.isDestroyed()) return;
            const cell = document.querySelector<HTMLElement>(selector);
            if (focus(cell)) { if (colId) api.setFocusedCell(target.rowIndex!, colId); }
            else focus(fallback());
          });
          return;
        }
        const cell = document.querySelector<HTMLElement>(selector);
        // 先无滚动聚焦，再同步表格焦点；反序会按重排动画中的位置滚动，动画结束后遮住目标。
        if (focus(cell)) {
          if (colId) api.setFocusedCell(index, colId);
          return;
        }
      }
    }
    focus(fallback());
  };
}
