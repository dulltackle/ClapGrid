import type { EditSession } from '../shared/client.js';
import type { ServiceStatus } from '../shared/contracts.js';

type Owner = 'segments' | 'settings';
type State = { owner: Owner | null; busy: boolean; editing: boolean };
type Action = { signal: AbortSignal; apply: (update: () => void) => void };
type Failure = (error: Error) => void;
type Holding = { owner: Owner; session: EditSession; disconnected: boolean; onDisconnect: () => void };

/** 面板内共享的编辑过程；HTTP 与可控时序测试使用同一 interface。 */
export function projectEditing(connect: () => Promise<EditSession>) {
  let active = true;
  let generation = 0;
  let query = 0;
  let acceptedQuery = 0;
  let holding: Holding | null = null;
  let operation: { owner: Owner | null; controller: AbortController } | null = null;
  let state: State = { owner: null, busy: false, editing: false };
  const listeners = new Set<() => void>();
  const publish = () => {
    state = { owner: holding?.owner ?? operation?.owner ?? null, busy: !!operation, editing: !!holding && !holding.disconnected };
    listeners.forEach(listener => listener());
  };
  const releases = new WeakMap<EditSession, Promise<void>>();
  const close = (session: EditSession) => {
    if (!releases.has(session)) releases.set(session, session.close().catch(() => {}));
    return releases.get(session)!;
  };
  const disconnect = (previous: Holding) => {
    if (holding !== previous) return;
    holding = null; generation++; publish();
    if (active) previous.onDisconnect();
  };
  const perform = async (owner: Owner | null, work: (action: Action) => Promise<void>, failed: Failure) => {
    if (!active || operation || (holding && holding.owner !== owner)) return;
    const current = { owner, controller: new AbortController() };
    operation = current; generation++; publish();
    const valid = () => active && operation === current;
    try {
      await work({ signal: current.controller.signal, apply: update => { if (valid()) update(); } });
    } catch (error) {
      if (valid()) failed(error instanceof Error ? error : new Error('未能确认操作结果，请重新读取；不会自动重试。'));
    } finally {
      if (operation === current) {
        operation = null; generation++;
        if (holding?.disconnected) disconnect(holding);
        publish();
      }
    }
  };
  const acquire = async (owner: Owner, signal: AbortSignal, onDisconnect: () => void) => {
    const session = await connect();
    if (signal.aborted || !active) { await close(session); throw new Error('编辑已取消'); }
    const next: Holding = { owner, session, disconnected: false, onDisconnect };
    holding = next;
    void session.closed.then(() => {
      if (holding !== next) return;
      next.disconnected = true;
      // 单次保存先关闭编辑连接，再返回提交结果；等待该请求，不能提前判失败。
      if (!operation) disconnect(next);
    });
    publish();
    return next;
  };
  const cancel = async (owner?: Owner) => {
    if (owner && holding?.owner !== owner && operation?.owner !== owner) return false;
    const previous = holding;
    holding = null;
    operation?.controller.abort();
    const closing = { owner: owner ?? null, controller: new AbortController() };
    operation = closing; generation++; publish();
    if (previous) await close(previous.session);
    if (operation !== closing) return false;
    operation = null; generation++; publish();
    return active;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getState: () => state,
    activate() { active = true; generation++; },
    deactivate() {
      const previous = holding;
      active = false; void cancel();
      previous?.onDisconnect();
    },
    cancel,
    finishCell() {
      const previous = holding;
      // AG Grid 的停止事件先于保存事件；只取消同一次、没有开始保存的编辑。
      queueMicrotask(() => { if (previous && holding === previous && !operation) void cancel('segments'); });
    },
    begin(owner: Owner, ready: (status: ServiceStatus) => void, onDisconnect: () => void, failed: Failure) {
      if (holding) return Promise.resolve();
      return perform(owner, async action => {
        const next = await acquire(owner, action.signal, onDisconnect);
        try { action.apply(() => ready(next.session.status)); }
        catch (error) {
          if (holding === next) holding = null;
          await close(next.session); throw error;
        }
      }, failed);
    },
    save(owner: Owner, options: { acquire?: boolean; retain?: boolean }, work: (token: string, action: Action) => Promise<void>, failed: Failure) {
      return perform(owner, async action => {
        const next = holding ?? (options.acquire ? await acquire(owner, action.signal, () => {}) : null);
        if (!next || next.disconnected) throw new Error('修改权已失效，请重新读取后编辑。');
        try { await work(next.session.token, action); }
        finally {
          if (!options.retain) {
            if (holding === next) holding = null;
            await close(next.session);
          }
        }
      }, failed);
    },
    run(work: (action: Action) => Promise<void>, failed: Failure) { return perform(null, work, failed); },
    async refresh<T>(load: () => Promise<T>, accept: (value: T) => void, failed: Failure) {
      if (!active || operation || holding) return;
      const version = generation;
      const request = ++query;
      const valid = () => active && version === generation && request > acceptedQuery && !operation && !holding;
      try { const result = await load(); if (valid()) { acceptedQuery = request; accept(result); } }
      catch (error) { if (valid()) { acceptedQuery = request; failed(error instanceof Error ? error : new Error('读取失败')); } }
    },
  };
}
export type ProjectEditing = ReturnType<typeof projectEditing>;
