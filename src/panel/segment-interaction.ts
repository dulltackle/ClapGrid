import { useEffect, useRef, useState } from 'react';
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
export function useSegmentInteraction({ editing, accept, save, failed, navigation, focus }: {
  editing: ProjectEditing; accept: (status: ServiceStatus) => void;
  save: (id: string, fields: { text: string; visualNote: string }) => Promise<boolean>; failed: (error: Error) => void;
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
  const latest = useRef({ save, accept }); latest.current = { save, accept };
  const sequence = useRef(0);
  const lifetime = useRef(0);
  const flight = useRef<Promise<boolean> | null>(null);
  const actionRunning = useRef<object | null>(null);
  useEffect(() => {
    const leave = () => { ++lifetime.current; ++sequence.current; actionRunning.current = null; flight.current = null; };
    window.addEventListener('pagehide', leave);
    return () => { leave(); window.removeEventListener('pagehide', leave); };
  }, []);
  const dirtyDraft = (value: Draft | null) => !!value && (value.text !== value.base || value.visualNote !== value.baseVisualNote);
  const dirty = dirtyDraft(draft);
  const disconnected = () => failed(new Error('编辑连接已断开，草稿已保留；请重新保存或放弃。'));
  const beginInline = (segment: Segment, field: SegmentTextField) => {
    update({ id: segment.id, base: segment.text, text: segment.text, baseVisualNote: segment.visualNote ?? '', visualNote: segment.visualNote ?? '', position: 'inline', field });
  };
  const commit = (): Promise<boolean> => {
    if (flight.current) return flight.current;
    const value = current.current;
    if (!value) return Promise.resolve(!editing.getState().busy);
    if (editing.getState().busy) return Promise.resolve(false);
    const version = lifetime.current;
    const valid = () => version === lifetime.current && current.current === value;
    const run = async () => {
      if (dirtyDraft(value)) {
        if (!editing.getState().editing) {
          let acquired = false;
          await editing.begin('segments', next => {
            const segment = next.snapshot.segments.find(item => item.id === value.id);
            if (!segment) throw new Error('口播片段已删除，草稿仍保留，请复制后放弃。');
            if (segment.text !== value.base || (segment.visualNote ?? '') !== value.baseVisualNote) throw new Error('文案或画面说明已被其他操作修改，草稿仍保留；不能覆盖新内容。');
            latest.current.accept(next); acquired = true;
          }, disconnected, failed);
          if (!acquired || !valid()) return false;
        }
        if (!await latest.current.save(value.id, { text: value.text, visualNote: value.visualNote })) return false;
      } else await editing.cancel('segments');
      if (!valid()) return false;
      update(null); return true;
    };
    const saving = run().finally(() => { if (flight.current === saving) flight.current = null; });
    flight.current = saving;
    return saving;
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
  const begin = (field: SegmentTextField = 'text', target = id) => {
    if (!target || current.current || editing.getState().editing || editing.getState().busy) return;
    const requested = navigation.intent();
    void editing.begin('segments', next => {
      if (!requested.valid()) { void editing.cancel('segments'); return; }
      const segment = next.snapshot.segments.find(item => item.id === target);
      if (!segment) throw new Error('口播片段已删除，请选择其他片段。');
      accept(next);
      update({ id: target, base: segment.text, text: segment.text, baseVisualNote: segment.visualNote ?? '', visualNote: segment.visualNote ?? '', position: 'details', field });
      setFocusRequest({ target: field, intent: requested });
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
  return { id, draft, dirty, pending, text, visualNote, panel, navigate, begin, beginInline, focusRequest, consumeFocus: () => setFocusRequest(null),
    change: (value: string, field: SegmentTextField = 'text') => { const previous = current.current; if (previous && !flight.current) update({ ...previous, [field]: value }); },
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

