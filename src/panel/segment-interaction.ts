import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GridApi } from 'ag-grid-community';
import { saveSegment } from '../shared/client.js';
import { panelServiceUrl } from './service-url.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
import type { FocusIntent, FocusReturn, segmentFocusCoordinator } from './dialog-focus.js';
import type { ProjectEditing } from './project-editing.js';
import type { SegmentDestination, SegmentNavigation, SegmentTextField } from './segment-navigation.js';

/** 右键与拖动共用固定身份范围，按项目顺序保留勾选集合的内部顺序。 */
export function segmentTargets(segments: Segment[], checkedIds: string[], id: string) {
  const ids = new Set(checkedIds.includes(id) ? checkedIds : [id]);
  return segments.filter(segment => ids.has(segment.id));
}

export type SegmentIntent = { id: string; inline?: boolean; field?: SegmentTextField; focusText?: boolean; edit?: boolean } | null;

type Draft = { id: string; base: string; text: string; baseVisualNote: string; visualNote: string; position: 'inline' | 'details'; field: SegmentTextField };

/** 勾选独立于查看和编辑；原位与详情共用一份草稿及修改权交接。 */
export function useSegmentInteraction({ editing, status, accept, canEdit, failed, navigation, focus, grid }: {
  editing: ProjectEditing; status: ServiceStatus | undefined; accept: (status: ServiceStatus) => void;
  canEdit: () => boolean; grid: () => GridApi<Segment> | null; failed: (error: Error) => void;
  navigation: SegmentNavigation; focus: ReturnType<typeof segmentFocusCoordinator>;
}) {
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef(draft);
  const update = (value: Draft | null) => { current.current = value; setDraft(value); };
  const [focusRequest, setFocusRequest] = useState<{ target: SegmentTextField | 'panel'; intent: FocusIntent } | null>(null);
  const [pending, setPending] = useState(false);
  const promptSource = useRef<HTMLElement | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const visualNote = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const latest = useRef({ accept }); latest.current = { accept };
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; visualNote: string; message: string } | null>(null);
  const draftFailed = (cause: Error) => {
    const value = current.current;
    if (value && dirtyDraft(value)) setFailure({ text: value.text, visualNote: value.visualNote, message: cause.message });
    else failed(cause);
  };
  const sequence = useRef(0);
  const lifetime = useRef(0);
  const flight = useRef<Promise<boolean> | null>(null);
  const actionRunning = useRef<object | null>(null);
  useEffect(() => {
    const leave = () => { ++lifetime.current; ++sequence.current; actionRunning.current = null; flight.current = null; setSaving(false); };
    window.addEventListener('pagehide', leave);
    return () => { leave(); window.removeEventListener('pagehide', leave); };
  }, []);
  const dirtyDraft = (value: Draft | null) => !!value && (value.text !== value.base || value.visualNote !== value.baseVisualNote);
  const dirty = dirtyDraft(draft);
  const disconnected = () => draftFailed(new Error('编辑连接已断开，草稿已保留；请重新保存或放弃。'));
  const commit = (): Promise<boolean> => {
    if (flight.current) return flight.current;
    const value = current.current;
    if (!value) return Promise.resolve(!editing.getState().busy);
    if (editing.getState().busy) return Promise.resolve(false);
    const version = lifetime.current;
    const valid = () => version === lifetime.current && current.current === value;
    const run = async () => {
      if (dirtyDraft(value)) {
        setSaving(true);
        if (!editing.getState().editing) {
          let acquired = false;
          await editing.begin('segments', next => {
            const segment = next.snapshot.segments.find(item => item.id === value.id);
            if (!segment) throw new Error('口播片段已删除，草稿仍保留，请复制后放弃。');
            if (segment.text !== value.base || (segment.visualNote ?? '') !== value.baseVisualNote) throw new Error('文案或画面说明已被其他操作修改，草稿仍保留；不能覆盖新内容。');
            latest.current.accept(next); acquired = true;
          }, disconnected, draftFailed);
          if (!acquired || !valid()) return false;
        }
        let saved = false;
        await editing.save('segments', {}, async (token, action) => {
          const next = await saveSegment(panelServiceUrl(), { id: value.id, text: value.text, visualNote: value.visualNote }, token);
          action.apply(() => { focus.acceptGridUpdate(() => latest.current.accept(next)); saved = true; });
        }, cause => draftFailed(new Error(`保存失败：${cause.message}`)));
        if (!saved) return false;
      } else await editing.cancel('segments');
      if (!valid()) return false;
      setFailure(null); update(null); return true;
    };
    const operation = run().finally(() => { if (flight.current === operation) { flight.current = null; setSaving(false); } });
    flight.current = operation;
    return operation;
  };
  const navigate = (intent: SegmentIntent, origin?: FocusReturn) => {
    if (actionRunning.current || (editing.getState().busy && !flight.current)) { origin?.cancel(); return; }
    const version = ++sequence.current;
    const ticket = navigation.request(origin, { waitForInline: true });
    const destination: SegmentDestination = intent && { ...intent, mode: intent.inline ? 'inline' : 'details' };
    void (async () => {
      if (!await commit()) { ticket.fail(); return; }
      if (version !== sequence.current || !ticket.valid()) { origin?.cancel(); return; }
      await ticket.arrive(() => {}, destination);
      if (intent?.edit && version === sequence.current && ticket.valid()) begin(intent.field, intent.id);
    })();
  };
  const begin = (field: SegmentTextField = 'text', target = id, position: Draft['position'] = 'details', requested = navigation.intent()) => {
    if (!target || current.current || editing.getState().editing || editing.getState().busy || !canEdit()) return Promise.resolve();
    return editing.begin('segments', next => {
      focus.acceptGridUpdate(() => accept(next));
      if (!requested.valid()) { void editing.cancel('segments'); return; }
      const segment = next.snapshot.segments.find(item => item.id === target);
      if (!segment) throw new Error('口播片段已删除，请选择其他片段。');
      setFailure(null);
      const value: Draft = { id: target, base: segment.text, text: segment.text, baseVisualNote: segment.visualNote ?? '', visualNote: segment.visualNote ?? '', position, field };
      // 原位 renderer 必须在修改权就绪时读到草稿；调用方不再处理表格时序。
      if (position === 'inline') flushSync(() => update(value));
      else { update(value); setFocusRequest({ target: field, intent: requested }); }
    }, disconnected, failed);
  };
  const discard = async () => {
    if (flight.current || editing.getState().busy) return;
    ++sequence.current; setPending(false);
    const value = current.current;
    const version = lifetime.current;
    const restore = value?.position === 'inline' ? focus.captureSegment({ id: value.id, column: value.field }) : undefined;
    await editing.cancel('segments');
    if (version !== lifetime.current || current.current !== value) { restore?.cancel(); return; }
    setFailure(null);
    if (restore) focus.close(restore, () => { update(null); restore(); });
    else { update(null); }
    if (value?.position === 'details') (value.field === 'text' ? text : visualNote).current?.focus();
  };
  const escape = () => {
    if (flight.current || editing.getState().busy) return;
    if (dirtyDraft(current.current)) { promptSource.current = document.activeElement as HTMLElement; setPending(true); }
    else if (current.current) void discard();
    else navigate(null);
  };
  const perform = async (work: (savedTarget: (target: Segment) => Segment) => Promise<void>) => {
    // 有副作用的动作只接受一次；导航才使用最新目标替换策略。
    if (actionRunning.current || flight.current || editing.getState().busy) return;
    const action = {}; actionRunning.current = action; ++sequence.current;
    const version = lifetime.current;
    const value = current.current;
    try {
      if (await commit() && version === lifetime.current && actionRunning.current === action) await work(target => {
        // 只衔接这次已确认保存的字段；菜单快照中的其他差异继续交给业务冲突检查。
        if (!value || value.id !== target.id || target.text !== value.base || target.visualNote !== value.baseVisualNote) return target;
        return { ...target, text: value.text, visualNote: value.visualNote };
      });
    }
    finally { if (actionRunning.current === action) actionRunning.current = null; }
  };
  const deleted = !!draft && !!status && !status.snapshot.segments.some(segment => segment.id === draft.id);
  const activeFailure = dirty ? failure : null;
  const draftStatus = deleted ? '无法保存 · 片段已删除' : saving ? '保存中…' : activeFailure
    ? (draft!.text !== activeFailure.text || draft!.visualNote !== activeFailure.visualNote ? '保存失败 · 未保存' : '保存失败')
    : dirty ? '未保存' : '已保存';
  const returnToDraft = () => {
    const value = current.current;
    if (!value) return;
    if (!deleted && value.position === 'inline') {
      const row = grid()?.getRowNode(value.id);
      if (row?.rowIndex != null) { grid()?.ensureColumnVisible(value.field); grid()?.ensureIndexVisible(row.rowIndex, 'middle'); }
    }
    const requested = navigation.intent();
    requestAnimationFrame(() => {
      if (!requested.valid() || current.current !== value) return;
      const input = deleted ? document.querySelector<HTMLTextAreaElement>(`[aria-label="已删除片段的${value.field === 'text' ? '文案' : '画面说明'}草稿"]`)
        : value.position === 'details' ? (value.field === 'text' ? text : visualNote).current
        : document.querySelector<HTMLTextAreaElement>('[data-inline-editor] textarea');
      input?.scrollIntoView({ block: 'nearest' }); input?.focus({ preventScroll: true });
    });
  };
  return { id, draft, dirty, deleted, saving, draftStatus, draftError: activeFailure?.message ?? '', returnToDraft, pending, text, visualNote, panel, navigate, begin, focusRequest, consumeFocus: () => setFocusRequest(null),
    change: (value: string, field: SegmentTextField = 'text') => {
      const previous = current.current;
      if (previous && !flight.current) {
        const next = { ...previous, [field]: value, field };
        if (!dirtyDraft(next)) setFailure(null);
        update(next);
      }
    },
    commit, perform, escape, discard,
    show: (destination: NonNullable<SegmentDestination>, intent: FocusIntent) => {
      setId(destination.id);
      if (destination.mode === 'details') setFocusRequest({ target: destination.field === 'visualNote' ? 'visualNote' : destination.focusText ? 'text' : 'panel', intent });
    },
    hide: () => setId(null),
    continueEditing: () => {
      setPending(false);
      requestAnimationFrame(() => {
        if (promptSource.current?.isConnected) { promptSource.current.focus(); return; }
        const value = current.current;
        if (value?.position === 'details') (value.field === 'text' ? text : visualNote).current?.focus();
        else document.querySelector<HTMLTextAreaElement>('[data-inline-editor] textarea')?.focus();
      });
    },
  };
}

