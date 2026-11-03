import type { GridApi } from 'ag-grid-community';
import type { Segment } from '../shared/contracts.js';
import type { FocusIntent, FocusReturn, segmentFocusCoordinator } from './dialog-focus.js';
import type { ProjectEditing } from './project-editing.js';

export type SegmentTextField = 'text' | 'visualNote';
export type SegmentDestination = { id: string; mode: 'locate' | 'inline'; field?: SegmentTextField; clearSearch?: boolean } | null;
type Focus = Pick<ReturnType<typeof segmentFocusCoordinator>, 'intent' | 'close' | 'captureSegment' | 'acceptGridUpdate'>;

/** 口播片段导航事务：快照始终接收，只有当前票据可以提交定位与来源。 */
export function segmentNavigation({ grid, editing, focus, clearSearch, inline, failed }: {
  grid: () => GridApi<Segment> | null;
  editing: Pick<ProjectEditing, 'getState' | 'subscribe' | 'cancel'>;
  focus: Focus; clearSearch: () => void;
  inline: (id: string, field: SegmentTextField, intent: FocusIntent) => Promise<void>;
  failed: (cause: Error) => void;
}) {
  let sequence = 0;
  let pending: FocusReturn | undefined;
  const intent = (): FocusIntent => {
    const version = sequence; const requested = focus.intent();
    return { valid: () => version === sequence && requested.valid() };
  };
  const waiting = new Set<() => void>();
  const idle = (valid: () => boolean) => new Promise<void>(resolve => {
    const check = () => { const state = editing.getState(); if (!valid() || (!state.busy && !state.editing)) { unsubscribe(); waiting.delete(check); resolve(); } };
    const unsubscribe = editing.subscribe(check); waiting.add(check); check();
  });
  const request = (origin?: FocusReturn, options: { waitForInline?: boolean } = {}) => {
    const rejected = editing.getState().busy && !options.waitForInline;
    if (rejected) origin?.cancel();
    else { sequence++; if (pending !== origin) pending?.cancel(); pending = origin; waiting.forEach(check => check()); }
    const requested = intent();
    const valid = () => !rejected && requested.valid();
    let ended = rejected;
    const cancel = () => { if (!ended) { ended = true; origin?.cancel(); if (pending === origin) pending = undefined; } };
    return {
      valid,
      async arrive(applySnapshot: () => void, destination?: SegmentDestination) {
        focus.acceptGridUpdate(applySnapshot);
        if (destination === undefined) return;
        if (ended) return;
        if (!valid()) { cancel(); return; }
        await idle(valid);
        if (!valid()) { cancel(); return; }
        if (!destination) {
          ended = true; pending = undefined;
          origin?.cancel(); return;
        }
        if (destination.clearSearch) { clearSearch(); grid()?.setFilterModel(null); }
        const row = grid()?.getRowNode(destination.id);
        if (row?.rowIndex == null) { cancel(); failed(new Error('口播片段已删除，请选择其他片段。')); return; }
        const field = destination.field ?? 'text';
        grid()?.ensureColumnVisible('text'); grid()?.ensureIndexVisible(row.rowIndex, 'middle');
        ended = true; pending = undefined;
        origin?.cancel();
        if (destination.mode === 'inline') await inline(destination.id, field, { valid });
      },
      fail() {
        if (ended) return;
        if (valid()) { ended = true; if (pending === origin) pending = undefined; origin?.(); }
        else cancel();
      },
    };
  };
  return { request, intent, dispose() { sequence++; pending?.cancel(); pending = undefined; waiting.forEach(check => check()); } };
}
export type SegmentNavigation = ReturnType<typeof segmentNavigation>;
