import { flushSync } from 'react-dom';
import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../shared/contracts.js';

type Grid = () => GridApi<Segment> | null;
type ElementRef = () => HTMLElement | null;
type Destination = { id: string; column?: string; details?: boolean };
type Origin = Partial<Destination> & { index: number; trigger?: HTMLElement; parent?: HTMLElement };
export type FocusIntent = { valid: () => boolean };
export type FocusReturn = (() => void) & { cancel: () => void };
type ReturnOptions = { fallback?: 'segment' | 'menu' };

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

/** 共享面板切换保留交接来源；片段子流程结束由来源处理父层及最上层返回。 */
export function restorePanelFocus(restore: () => void, withinLayer = false) {
  const top = layers().at(-1);
  if (top) {
    if (withinLayer) restore();
    if (!top.contains(document.activeElement) || !available(document.activeElement as HTMLElement)) focus(top);
  } else if (document.activeElement === document.body || !available(document.activeElement as HTMLElement)) restore();
  else (restore as Partial<FocusReturn>).cancel?.();
}

/** 片段流程的来源独立于待执行返回；用户新操作只取消旧意图，不删除父流程来源。 */
export function segmentFocusCoordinator(grid: Grid, fallback: { search: ElementRef; table: ElementRef; more: ElementRef }) {
  let epoch = 0;
  let present = true;
  const preparations = new WeakMap<() => void, () => void>();
  const contexts = new WeakMap<() => void, () => boolean>();
  let pending: (() => void) | undefined;
  const cancelPending = () => { epoch++; pending?.(); pending = undefined; };
  const intent = (origin?: () => void): FocusIntent => {
    const current = epoch;
    const startedPresent = present;
    return { valid: () => startedPresent && present && epoch === current && (!origin || (contexts.get(origin)?.() ?? false)) };
  };
  const listen = () => {
    // 不观察控件 focus/blur 和普通 scroll：卸载、轮询、恢复自身也会产生这些事件。
    const events = ['pointerdown', 'keydown', 'beforeinput', 'input', 'wheel', 'touchmove'] as const;
    // Escape 可能被业务忙态拒绝；只有实际允许的关闭才在 close 中使旧意图失效。
    const interaction = (event: Event) => { if (!(event instanceof KeyboardEvent && event.key === 'Escape')) cancelPending(); };
    const leave = () => { present = false; cancelPending(); };
    const enter = () => { present = true; cancelPending(); };
    const visibility = () => { present = document.visibilityState !== 'hidden'; cancelPending(); };
    for (const event of events) document.addEventListener(event, interaction, true);
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('focus', enter);
    window.addEventListener('pageshow', enter);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelPending();
      for (const event of events) document.removeEventListener(event, interaction, true);
      window.removeEventListener('blur', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('focus', enter);
      window.removeEventListener('pageshow', enter);
      document.removeEventListener('visibilitychange', visibility);
    };
  };
  const source = (origin: Origin, options: ReturnOptions): FocusReturn => {
    let ended = false;
    let closingIntent: FocusIntent | undefined;
    let stop: (() => void) | undefined;
    const restore = (() => {
      if (ended) return;
      ended = true;
      if (!present || (closingIntent && !closingIntent.valid())) return;
      pending?.();
      const current = epoch;
      const closingFocus = document.activeElement;
      let frame = 0;
      let finished = false;
      const finish = () => { finished = true; if (frame) cancelAnimationFrame(frame); if (pending === finish) pending = undefined; };
      pending = finish;
      stop = finish;
      const valid = () => !finished && epoch === current;
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
    contexts.set(restore, () => !ended && (document.activeElement === document.body || document.activeElement === origin.trigger || !!origin.parent?.contains(document.activeElement)));
    preparations.set(restore, () => {
      if (ended || closingIntent) return;
      cancelPending();
      closingIntent = intent();
    });
    restore.cancel = () => { ended = true; stop?.(); };
    return restore;
  };
  const capture = (trigger: HTMLElement, options: ReturnOptions = {}): FocusReturn => {
    cancelPending();
    const row = trigger.closest('[row-id]');
    return source({ trigger, parent: trigger.closest<HTMLElement>('[aria-label="口播片段详情"], [role="dialog"], [role="alertdialog"]') ?? undefined,
      id: row?.getAttribute('row-id') ?? undefined, index: Number(row?.getAttribute('row-index') ?? 0),
      column: trigger.hasAttribute('data-row-details') ? undefined : trigger.closest('[col-id]')?.getAttribute('col-id') ?? undefined, details: trigger.hasAttribute('data-row-details') }, options);
  };
  const captureSegment = (destination: Destination, options: ReturnOptions = {}): FocusReturn => {
    const api = grid();
    const index = api && !api.isDestroyed() ? api.getRowNode(destination.id)?.rowIndex ?? Math.max(0, api.getDisplayedRowCount() - 1) : 0;
    return source({ ...destination, index }, options);
  };
  /** 接收合法数据时保留用户当前表格位置，不重放已经取消的流程来源。 */
  const acceptGridUpdate = (apply: () => void) => {
    const active = document.activeElement;
    const api = grid();
    const row = active instanceof HTMLElement ? active.closest('[row-id]') : null;
    const id = row?.getAttribute('row-id');
    const details = active instanceof HTMLElement && active.hasAttribute('data-row-details');
    const column = active instanceof HTMLElement && active.matches('[role="gridcell"][col-id]') ? active.getAttribute('col-id') : null;
    const current = intent();
    // AG Grid 默认在刷新后按旧 rowIndex 重新聚焦；先清除该缓存，稳定身份由此处维护。
    const preserve = id && (details || column) && api && !api.isDestroyed() && api.getRowNode(id)?.rowIndex != null;
    if (preserve) api.clearFocusedCell();
    flushSync(apply);
    if (!preserve || !current.valid() || api.isDestroyed() || layers().length) return;
    const node = api.getRowNode(id);
    if (node?.rowIndex == null) return;
    const selector = `[row-id="${CSS.escape(id)}"] ${details ? '[data-row-details]' : `[col-id="${CSS.escape(column!)}"]`}`;
    const target = document.querySelector<HTMLElement>(selector);
    if (!focus(target)) return;
    if (column) api.setFocusedCell(node.rowIndex, column);
  };
  // 在业务已允许关闭时固定意图；Portal 稍后发来的自动焦点回调不能重新取得恢复权。
  const close = (restore: () => void, action: () => void) => { preparations.get(restore)?.(); action(); };
  return { capture, captureSegment, intent, cancelPending, listen, close, acceptGridUpdate };
}
