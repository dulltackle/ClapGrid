import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GridApi } from 'ag-grid-community';
import { queryStatus, saveSegment } from '../shared/client.js';
import { panelServiceUrl } from './service-url.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
import type { FocusReturn, segmentFocusCoordinator } from './dialog-focus.js';
import type { ProjectEditing } from './project-editing.js';
import type { SegmentDestination, SegmentNavigation } from './segment-navigation.js';

export { segmentTargets } from './segment-targets.js';

export type SegmentIntent = { id: string; preventScroll?: boolean } | null;

type Draft = { id: string; base: string; text: string };

/** 勾选独立于编辑；文案草稿保留修改权交接。 */
export function useSegmentInteraction({ editing, status, accept, canEdit, failed, navigation, focus, grid }: {
  editing: ProjectEditing; status: ServiceStatus | undefined; accept: (status: ServiceStatus) => void;
  canEdit: () => boolean; grid: () => GridApi<Segment> | null; failed: (error: Error) => void;
  navigation: SegmentNavigation; focus: ReturnType<typeof segmentFocusCoordinator>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef(draft);
  const update = (value: Draft | null) => { current.current = value; setDraft(value); };
  const [pending, setPending] = useState(false);
  const promptSource = useRef<HTMLElement | null>(null);
  const latest = useRef({ accept }); latest.current = { accept };
  const [saving, setSaving] = useState(false);
  const [navigating, setNavigating] = useState(false);
  // 释放修改权后仍需确认服务状态，避免旧的“用户正在编辑”造成控件再禁用一帧。
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
  const draftFailed = (cause: Error) => {
    const value = current.current;
    if (value && dirtyDraft(value)) setFailure({ text: value.text, message: cause.message });
    else failed(cause);
  };
  const sequence = useRef(0);
  const lifetime = useRef(0);
  const flight = useRef<Promise<boolean> | null>(null);
  const actionRunning = useRef<object | null>(null);
  const navigationFlight = useRef<{ done: Promise<void> } | null>(null);
  useEffect(() => {
    const leave = () => { ++lifetime.current; ++sequence.current; actionRunning.current = null; flight.current = null; navigationFlight.current = null; setSaving(false); setNavigating(false); setFinishing(false); };
    window.addEventListener('pagehide', leave);
    return () => { leave(); window.removeEventListener('pagehide', leave); };
  }, []);
  const dirtyDraft = (value: Draft | null) => !!value && value.text !== value.base;
  const dirty = dirtyDraft(draft);
  const disconnected = () => draftFailed(new Error('编辑连接已断开，草稿已保留；请重新保存或放弃。'));
  const commit = (): Promise<boolean> => {
    if (flight.current) return flight.current;
    if (finishing) return Promise.resolve(false);
    const value = current.current;
    if (!value) return Promise.resolve(!editing.getState().busy);
    if (editing.getState().busy) return Promise.resolve(false);
    const version = lifetime.current;
    const valid = () => version === lifetime.current && current.current === value;
    setFinishing(true);
    const run = async () => {
      if (dirtyDraft(value)) {
        setSaving(true);
        if (!editing.getState().editing) {
          let acquired = false;
          await editing.begin('segments', next => {
            const segment = next.snapshot.segments.find(item => item.id === value.id);
            if (!segment) throw new Error('口播片段已删除，草稿仍保留，请复制后放弃。');
            if (segment.text !== value.base) throw new Error('文案已被其他操作修改，草稿仍保留；不能覆盖新内容。');
            latest.current.accept(next); acquired = true;
          }, disconnected, draftFailed);
          if (!acquired || !valid()) return false;
        }
        let saved = false;
        await editing.save('segments', {}, async (token, action) => {
          const next = await saveSegment(panelServiceUrl(), { id: value.id, text: value.text }, token);
          action.apply(() => { focus.acceptGridUpdate(() => latest.current.accept(next)); saved = true; });
        }, cause => draftFailed(new Error(`保存失败：${cause.message}`)));
        if (!saved) return false;
      } else await editing.cancel('segments');
      const released = await queryStatus(panelServiceUrl());
      if (!valid()) return false;
      focus.acceptGridUpdate(() => latest.current.accept(released));
      setFailure(null); update(null); return true;
    };
    const operation = run().catch(cause => { if (valid()) draftFailed(cause instanceof Error ? cause : new Error('读取项目状态失败')); return false; }).finally(() => { if (flight.current === operation) { flight.current = null; setSaving(false); setFinishing(false); } });
    flight.current = operation;
    return operation;
  };
  const navigate = (intent: SegmentIntent, origin?: FocusReturn) => {
    if (actionRunning.current || ((finishing || editing.getState().busy) && !flight.current && !navigationFlight.current)) { origin?.cancel(); return; }
    const version = ++sequence.current;
    const ticket = navigation.request(origin, { waitForInline: true });
    const destination: SegmentDestination = intent && { ...intent, mode: 'inline' };
    // 保存中的新目标共用原提交结果，不能用交接期间捕获的忙态再次提交。
    const pendingCommit = flight.current;
    const previous = navigationFlight.current?.done;
    const transition = { done: Promise.resolve() };
    navigationFlight.current = transition;
    setNavigating(true);
    transition.done = (async () => {
      try {
        // 连续点击可替换目标，但要等上次申请或释放修改权结束，不能在忙态丢弃新目标。
        await previous;
        if (version !== sequence.current || !ticket.valid()) { origin?.cancel(); return; }
        if (!await (pendingCommit ?? commit())) { ticket.fail(); return; }
        if (version !== sequence.current || !ticket.valid()) { origin?.cancel(); return; }
        await ticket.arrive(() => {}, destination);
      } finally {
        if (navigationFlight.current === transition) { navigationFlight.current = null; setNavigating(false); }
      }
    })();
  };
  const begin = async (target: string, requested = navigation.intent()) => {
    if (current.current || editing.getState().editing || editing.getState().busy || !canEdit()) return Promise.resolve();
    let cancelled: Promise<boolean> | undefined;
    await editing.begin('segments', next => {
      focus.acceptGridUpdate(() => accept(next));
      if (!requested.valid()) { cancelled = editing.cancel('segments'); return; }
      const segment = next.snapshot.segments.find(item => item.id === target);
      if (!segment) throw new Error('口播片段已删除，请选择其他片段。');
      setFailure(null);
      const value: Draft = { id: target, base: segment.text, text: segment.text };
      // 原位 renderer 必须在修改权就绪时读到草稿；调用方不再处理表格时序。
      flushSync(() => update(value));
    }, disconnected, failed);
    // 过期目标释放完成后，下一次导航才可重新申请。
    await cancelled;
  };
  const discard = async () => {
    if (finishing || flight.current || editing.getState().busy) return;
    ++sequence.current; setPending(false);
    const value = current.current;
    const version = lifetime.current;
    const restore = value ? focus.captureSegment({ id: value.id, column: 'text' }, { preventScroll: true }) : undefined;
    setFinishing(true);
    try {
      await editing.cancel('segments');
      const released = await queryStatus(panelServiceUrl());
      if (version !== lifetime.current || current.current !== value) { restore?.cancel(); return; }
      focus.acceptGridUpdate(() => latest.current.accept(released));
      setFailure(null);
      if (restore) focus.close(restore, () => { update(null); restore(); });
      else { update(null); }
    } catch (cause) { restore?.cancel(); if (version === lifetime.current) draftFailed(cause instanceof Error ? cause : new Error('读取项目状态失败')); }
    finally { if (version === lifetime.current) setFinishing(false); }
  };
  const escape = () => {
    if (finishing || flight.current || editing.getState().busy) return;
    if (dirtyDraft(current.current)) { promptSource.current = document.activeElement as HTMLElement; setPending(true); }
    else if (current.current) void discard();
    else navigate(null);
  };
  const perform = async (work: (savedTarget: (target: Segment) => Segment) => Promise<void>) => {
    // 有副作用的动作只接受一次；导航才使用最新目标替换策略。
    if (finishing || actionRunning.current || flight.current || editing.getState().busy) return;
    const action = {}; actionRunning.current = action; ++sequence.current;
    const version = lifetime.current;
    const value = current.current;
    try {
      if (await commit() && version === lifetime.current && actionRunning.current === action) await work(target => {
        // 只衔接这次已确认保存的字段；菜单快照中的其他差异继续交给业务冲突检查。
        if (!value || value.id !== target.id || target.text !== value.base) return target;
        return { ...target, text: value.text };
      });
    }
    finally { if (actionRunning.current === action) actionRunning.current = null; }
  };
  const deleted = !!draft && !!status && !status.snapshot.segments.some(segment => segment.id === draft.id);
  const activeFailure = dirty ? failure : null;
  const draftStatus = deleted ? '无法保存 · 片段已删除' : saving ? '保存中…' : activeFailure
    ? (draft!.text !== activeFailure.text ? '保存失败 · 未保存' : '保存失败')
    : dirty ? '未保存' : '';
  const returnToDraft = () => {
    const value = current.current;
    if (!value) return;
    if (!deleted) {
      const row = grid()?.getRowNode(value.id);
      if (row?.rowIndex != null) { grid()?.ensureColumnVisible('text'); grid()?.ensureIndexVisible(row.rowIndex, 'middle'); }
    }
    const requested = navigation.intent();
    requestAnimationFrame(() => {
      if (!requested.valid() || current.current !== value) return;
      const input = document.querySelector<HTMLTextAreaElement>('[data-inline-editor] textarea');
      input?.scrollIntoView({ block: 'nearest' }); input?.focus({ preventScroll: true });
    });
  };
  return { draft, dirty, deleted, saving, navigating, finishing, draftStatus, draftError: activeFailure?.message ?? '', returnToDraft, pending, navigate, begin,
    change: (value: string) => {
      const previous = current.current;
      if (previous && !finishing && !flight.current) {
        const next = { ...previous, text: value };
        if (!dirtyDraft(next)) setFailure(null);
        update(next);
      }
    },
    commit, perform, escape, discard,
    save: async () => {
      const value = current.current;
      const restore = value ? focus.captureSegment({ id: value.id, column: 'text' }, { preventScroll: true }) : undefined;
      const requested = navigation.intent();
      if (await commit() && requested.valid()) restore?.(); else restore?.cancel();
    },
    continueEditing: () => {
      setPending(false);
      requestAnimationFrame(() => {
        if (promptSource.current?.isConnected) { promptSource.current.focus(); return; }
        document.querySelector<HTMLTextAreaElement>('[data-inline-editor] textarea')?.focus();
      });
    },
  };
}

