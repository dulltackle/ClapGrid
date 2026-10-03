import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../shared/contracts.js';

/** 记录稳定片段身份，避免轮询或虚拟滚动重建单元格后依赖旧 DOM。 */
export function dialogReturnFocus(trigger: HTMLElement, grid: () => GridApi<Segment> | null, fallback: () => HTMLElement | null) {
  const row = trigger.closest('[row-id]');
  const segmentId = row?.getAttribute('row-id');
  const rowIndex = Number(row?.getAttribute('row-index') ?? 0);
  const colId = trigger.closest('[col-id]')?.getAttribute('col-id');
  const focus = (element: HTMLElement | null | undefined) => {
    if (!element?.isConnected || element.matches(':disabled') || !element.getClientRects().length) return false;
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  };
  return () => {
    if (!segmentId && focus(trigger)) return;
    const api = grid();
    if (segmentId && colId && api && !api.isDestroyed()) {
      const original = api.getRowNode(segmentId);
      const index = original?.rowIndex ?? Math.min(rowIndex, api.getDisplayedRowCount() - 1);
      const target = index >= 0 ? api.getDisplayedRowAtIndex(index) : undefined;
      if (target) {
        const selector = `[row-id="${CSS.escape(target.id!)}"] [col-id="${CSS.escape(colId)}"]`;
        // 缓冲行虽然有 DOM，仍可能被视口裁剪；正常返回不移动横纵位置。
        const range = api.getVerticalPixelRange();
        const top = target.rowTop ?? 0;
        if (!document.querySelector(selector) || top < range.top || top + (target.rowHeight ?? 0) > range.bottom) {
          api.ensureIndexVisible(index);
        }
        if (!document.querySelector(selector)) api.ensureColumnVisible(colId);
        const cell = document.querySelector<HTMLElement>(selector);
        // 先无滚动聚焦，再同步表格焦点；反序会按重排动画中的位置滚动，动画结束后遮住目标。
        if (focus(cell)) {
          api.setFocusedCell(index, colId);
          return;
        }
      }
    }
    focus(fallback());
  };
}
