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
  const inline = vi.fn(async (_id: string, _field: string, _intent: { valid: () => boolean }) => {});
  const acceptGridUpdate = vi.fn((apply: () => void) => apply());
  const cancel = vi.fn(async () => true);
  const navigation = segmentNavigation({
    grid: () => grid as unknown as GridApi<Segment>,
    editing: { getState: () => ({ busy, editing: false, owner: null }), subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, cancel },
    focus: { intent: () => { const version = epoch; return { valid: () => epoch === version }; }, acceptGridUpdate, close: (_origin, apply) => apply(), captureSegment: () => origin() },
    clearSearch: vi.fn(), inline, failed: vi.fn(),
  });
  return { navigation, grid, row, inline, acceptGridUpdate, cancel,
    interact: () => { epoch++; }, busy: (value: boolean) => { busy = value; listeners.forEach(listener => listener()); } };
}
function origin() { return Object.assign(vi.fn(), { cancel: vi.fn() }) as FocusReturn; }

test('迟到成功接收快照但不定位、勾选或启动编辑', async () => {
  const f = fixture(); const source = origin(); const ticket = f.navigation.request(source); const apply = vi.fn();
  f.interact();
  await ticket.arrive(apply, { id: 'a', mode: 'inline' });
  expect(apply).toHaveBeenCalledOnce(); expect(f.acceptGridUpdate).toHaveBeenCalledOnce();
  expect(f.grid.ensureIndexVisible).not.toHaveBeenCalled(); expect(f.row.setSelected).not.toHaveBeenCalled();
  expect(f.inline).not.toHaveBeenCalled(); expect(source.cancel).toHaveBeenCalledOnce();
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
  await current.arrive(() => {}, { id: 'b', mode: 'inline' });
  expect(apply).toHaveBeenCalledOnce();
  expect(f.inline).toHaveBeenCalledOnce(); expect(f.inline.mock.calls[0]![0]).toBe('b');
  expect(source).not.toHaveBeenCalled();
});

test('忙态拒绝导航且不替换已有编辑目标', async () => {
  const f = fixture(); const source = origin();
  await f.navigation.request(source).arrive(() => {}, { id: 'a', mode: 'inline' });
  f.busy(true); const refused = origin();
  await f.navigation.request(refused).arrive(() => {}, { id: 'b', mode: 'inline' });
  expect(refused.cancel).toHaveBeenCalledOnce(); expect(f.inline).toHaveBeenCalledOnce();
  f.busy(false); await f.navigation.request().arrive(() => {}, null);
  expect(source.cancel).toHaveBeenCalled();
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

test('普通新增清除查找后定位并开始原位文案编辑', async () => {
  const f = fixture();
  await f.navigation.request().arrive(() => {}, { id: 'new', mode: 'inline', clearSearch: true });
  expect(f.grid.setFilterModel).toHaveBeenCalledWith(null);
  expect(f.grid.ensureIndexVisible).toHaveBeenCalledWith(3, 'middle');
  expect(f.row.setSelected).not.toHaveBeenCalled();
  expect(f.inline.mock.calls[0]![0]).toBe('new');
});


test('原位导航将稳定身份和当前意图交给编辑入口', async () => {
  const f = fixture();
  await f.navigation.request().arrive(() => {}, { id: 'a', mode: 'inline', field: 'text' });
  const [id, field, intent] = f.inline.mock.calls[0]!;
  expect(id).toBe('a'); expect(field).toBe('text'); expect(intent.valid()).toBe(true);
  f.interact(); expect(intent.valid()).toBe(false);
});
