import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../../src/shared/contracts.js';
import { segmentFocusCoordinator, type FocusReturn, type FocusIntent } from '../../src/panel/dialog-focus.js';

/** 只为焦点模块提供最小 GridApi seam；真实虚拟表格另由 focus.spec.ts 验证。 */
function focusFixture() {
  let ids = ['a', 'b', 'c'];
  let hidden = false;
  let lookups = 0;
  let restore: FocusReturn | undefined;
  let inputIntent: FocusIntent | undefined;
  const row = (id: string) => {
    const rowIndex = ids.indexOf(id);
    return rowIndex < 0 ? undefined : { id, rowIndex, rowTop: rowIndex * 80, rowHeight: 80 };
  };
  const grid = {
    isDestroyed: () => false,
    getRowNode: (id: string) => { lookups++; return row(id); },
    getDisplayedRowCount: () => ids.length,
    getDisplayedRowAtIndex: (index: number) => ids[index] ? row(ids[index]!) : undefined,
    getVerticalPixelRange: () => ({ top: 0, bottom: 10000 }),
    ensureIndexVisible: () => {},
    ensureColumnVisible: () => {},
    setFocusedCell: () => {},
  } as unknown as GridApi<Segment>;
  const coordinator = segmentFocusCoordinator(() => grid, {
    search: () => document.querySelector<HTMLInputElement>('#search'),
    table: () => document.querySelector<HTMLButtonElement>('#table'),
    more: () => document.querySelector<HTMLButtonElement>('#more'),
  });
  coordinator.listen();
  const render = () => {
    const container = document.querySelector('#rows')!;
    container.replaceChildren(...ids.map(id => {
      const element = document.createElement('div');
      element.setAttribute('row-id', id);
      const cell = document.createElement('div');
      cell.setAttribute('col-id', 'text'); cell.setAttribute('role', 'gridcell');
      cell.tabIndex = 0; cell.textContent = id;
      cell.style.visibility = hidden ? 'hidden' : 'visible';
      element.append(cell); return element;
    }));
  };
  render();
  return {
    capture(id = 'a') { restore = coordinator.captureSegment({ id, column: 'text' }); lookups = 0; },
    close() {
      if (!restore) throw Error('缺少片段来源');
      coordinator.close(restore, () => (document.activeElement as HTMLElement)?.blur()); restore();
      inputIntent = coordinator.intent();
    },
    rows(next: string[]) { ids = [...next]; render(); },
    hideTargets(value: boolean) { hidden = value; render(); },
    get lookups() { return lookups; },
    get intentValid() { return inputIntent?.valid(); },
  };
}

declare global { interface Window { focusFixture: ReturnType<typeof focusFixture> } }
window.focusFixture = focusFixture();
