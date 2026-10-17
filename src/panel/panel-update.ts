import { useEffect, useRef, useState } from 'react';
import { compatibleRuntime, type BuildIdentity } from '../build-identity.js';
import type { TableSession } from '../shared/client.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PanelRestore = { projectId: string; instanceId: string; panelFingerprint: string; selectedIds: string[]; createdAt: number };
export const panelRestoreKey = (url: string) => `clapgrid-panel-refresh:${url}`;
const validRestore = (value: Partial<PanelRestore>, now: number) => typeof value.projectId === 'string' && typeof value.instanceId === 'string'
  && typeof value.panelFingerprint === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.panelFingerprint)
  && typeof value.createdAt === 'number' && now - value.createdAt <= 120000 && value.createdAt <= now + 5000
  && Array.isArray(value.selectedIds) && value.selectedIds.length <= 10000 && value.selectedIds.every(id => typeof id === 'string');

/** 刷新恢复只消费同一标签页的一次显式请求，不把空勾选扩大成全选。 */
export function readPanelRestore(storage: StorageLike, key: string, now = Date.now()): PanelRestore | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    storage.removeItem(key);
    const value = JSON.parse(raw) as Partial<PanelRestore>;
    if (!validRestore(value, now)) return null;
    return value as PanelRestore;
  } catch { return null; }
}

export function writePanelRestore(storage: StorageLike, key: string, value: PanelRestore) {
  if (!validRestore(value, value.createdAt)) return false;
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function restoredSelection(value: PanelRestore, projectId: string, instanceId: string, loaded: BuildIdentity, ids: string[]): string[] | null {
  if (value.projectId !== projectId || value.instanceId !== instanceId || loaded.state !== 'known' || loaded.schemaVersion !== 2
    || loaded.panelFingerprint !== value.panelFingerprint) return null;
  const existing = new Set(ids);
  return [...new Set(value.selectedIds)].filter(id => existing.has(id));
}

export function panelNeedsRefresh(loaded: BuildIdentity, active?: BuildIdentity) {
  return loaded.state === 'known' && active?.state === 'known' && loaded.schemaVersion === 2 && active.schemaVersion === 2
    && compatibleRuntime(loaded, active) && !!loaded.panelFingerprint && !!active.panelFingerprint && loaded.panelFingerprint !== active.panelFingerprint;
}

export function panelCompatibility(loaded: BuildIdentity, runtime?: BuildIdentity, active?: BuildIdentity) {
  if (loaded.state !== 'known' || runtime?.state !== 'known') return '尚未验证版本一致性';
  if (!compatibleRuntime(loaded, runtime)) return '版本不一致，请更新插件并重新打开';
  if (panelNeedsRefresh(loaded, active)) return '有新版面板，刷新后生效';
  return '面板与服务一致';
}

/** 播放器包括详情和浮窗，不仅是行内配音。 */
export function useMediaBusy() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setBusy([...document.querySelectorAll<HTMLMediaElement>('audio, video')].some(media => !media.paused && !media.ended));
    for (const type of ['play', 'pause', 'ended', 'emptied']) document.addEventListener(type, update, true);
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('audio, video') || !!node.querySelector('audio, video'))))) update();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => { observer.disconnect(); for (const type of ['play', 'pause', 'ended', 'emptied']) document.removeEventListener(type, update, true); };
  }, []);
  return busy;
}

/** 心跳失效由服务保守阻止切换，活动报告失败不擅自重连或刷新页面。 */
export function usePanelActivity(table: { current: TableSession | null }, enabled: boolean, busy: boolean) {
  const latest = useRef({ enabled, busy });
  latest.current = { enabled, busy };
  useEffect(() => {
    const send = () => { if (latest.current.enabled) void table.current?.activity?.(latest.current.busy).catch(() => {}); };
    send(); const timer = window.setInterval(send, 2000);
    return () => clearInterval(timer);
  }, [table, enabled]);
  useEffect(() => { if (enabled) void table.current?.activity?.(busy).catch(() => {}); }, [table, enabled, busy]);
}
