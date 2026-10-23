import { test, expect, vi } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../src/shared/contracts.js';
import type { FocusReturn } from '../src/panel/dialog-focus.js';
import { segmentNavigation } from '../src/panel/segment-navigation.js';

function fixture() {
  let epoch = 0;
  let busy = false;
  const listeners = new Set<() => void>();
  const row = { rowIndex: 3, setSelected: vi.fn() };
  const grid = { getRowNode: vi.fn(() => row), ensureColumnVisible: vi.fn(), ensureIndexVisible: vi.fn(), setFilterModel: vi.fn(), startEditingCell: vi.fn() };
  const details = { isOpen: () => false, show: vi.fn(), hide: vi.fn() };
  const inline = vi.fn(async (ready: (apply: () => void) => void) => { ready(() => {}); });
  const acceptGridUpdate = vi.fn((apply: () => void) => apply());
  const cancel = vi.fn(async () => true);
  const navigation = segmentNavigation({
    grid: () => grid as unknown as GridApi<Segment>,
    editing: { getState: () => ({ busy, editing: false, owner: null }), subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, cancel },
    focus: { intent: () => { const version = epoch; return { valid: () => epoch === version }; }, acceptGridUpdate, close: (_origin, apply) => apply(), captureSegment: () => origin() },
    stopInline: vi.fn(), clearSearch: vi.fn(), details, inline, failed: vi.fn(),
  });
  return { navigation, grid, row, details, inline, acceptGridUpdate, cancel,
    interact: () => { epoch++; }, busy: (value: boolean) => { busy = value; listeners.forEach(listener => listener()); } };
}
function origin() { return Object.assign(vi.fn(), { cancel: vi.fn() }) as FocusReturn; }

test('迟到成功接收快照但不定位、勾选或打开详情', async () => {
  const f = fixture(); const source = origin(); const ticket = f.navigation.request(source); const apply = vi.fn();
  f.interact();
  await ticket.arrive(apply, { id: 'a', mode: 'details' });
  expect(apply).toHaveBeenCalledOnce(); expect(f.acceptGridUpdate).toHaveBeenCalledOnce();
  expect(f.grid.ensureIndexVisible).not.toHaveBeenCalled(); expect(f.row.setSelected).not.toHaveBeenCalled();
  expect(f.details.show).not.toHaveBeenCalled(); expect(source.cancel).toHaveBeenCalledOnce();
});

test('迟到失败取消来源，有效失败才恢复来源', () => {
  const f = fixture(); const stale = origin(); const ticket = f.navigation.request(stale);
  f.interact(); ticket.fail(); expect(stale).not.toHaveBeenCalled(); expect(stale.cancel).toHaveBeenCalledOnce();
  const current = origin(); f.navigation.request(current).fail(); expect(current).toHaveBeenCalledOnce();
});

test('新票据取代等待中的旧票据，但仍接收旧快照', async () => {
  const f = fixture(); const source = origin(); const old = f.navigation.request(source);
  const current = f.navigation.request(); const apply = vi.fn();
  await old.arrive(apply, { id: 'a', mode: 'inline' });
  await current.arrive(() => {}, { id: 'b', mode: 'details' });
  expect(apply).toHaveBeenCalledOnce(); expect(f.inline).not.toHaveBeenCalled();
  expect(f.details.show).toHaveBeenCalledOnce(); expect(f.details.show.mock.calls[0]![0].id).toBe('b');
  expect(source).not.toHaveBeenCalled();
});

test('忙态拒绝导航且不替换已有详情来源', async () => {
  const f = fixture(); const source = origin();
  await f.navigation.request(source).arrive(() => {}, { id: 'a', mode: 'details' });
  f.busy(true); const refused = origin();
  await f.navigation.request(refused).arrive(() => {}, { id: 'b', mode: 'details' });
  expect(refused.cancel).toHaveBeenCalledOnce(); expect(f.details.show).toHaveBeenCalledOnce();
  f.busy(false); await f.navigation.request().arrive(() => {}, null);
  expect(source).toHaveBeenCalledOnce();
});

test('等待行内保存结束时，后发导航接管同一序列', async () => {
  const f = fixture(); const old = f.navigation.request();
  f.busy(true);
  const arriving = old.arrive(() => {}, { id: 'a', mode: 'inline' });
  const current = f.navigation.request(undefined, { waitForInline: true });
  const continuing = current.arrive(() => {}, { id: 'b', mode: 'inline' });
  await arriving; expect(f.inline).not.toHaveBeenCalled();
  f.busy(false); await continuing;
  expect(f.inline).toHaveBeenCalledOnce(); expect(f.grid.getRowNode).toHaveBeenLastCalledWith('b');
});

test('普通新增清除查找后定位、勾选并请求详情文案焦点', async () => {
  const f = fixture();
  await f.navigation.request().arrive(() => {}, { id: 'new', mode: 'details', clearSearch: true, focusText: true });
  expect(f.grid.setFilterModel).toHaveBeenCalledWith(null);
  expect(f.grid.ensureIndexVisible).toHaveBeenCalledWith(3, 'middle');
  expect(f.row.setSelected).toHaveBeenCalledWith(true, true);
  expect(f.details.show.mock.calls[0]![0]).toMatchObject({ id: 'new', focusText: true });
});


test('行内修改权迟到仍接收快照，并释放租约而不开始编辑', async () => {
  const f = fixture(); let release!: () => void; let received!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { received = resolve; });
  const apply = vi.fn();
  f.inline.mockImplementationOnce(async ready => { received(); await gate; ready(apply); });
  const navigating = f.navigation.request().arrive(() => {}, { id: 'a', mode: 'inline' });
  await requested; f.interact(); release(); await navigating;
  expect(apply).toHaveBeenCalledOnce(); expect(f.acceptGridUpdate).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalledWith('segments'); expect(f.grid.startEditingCell).not.toHaveBeenCalled();
});
