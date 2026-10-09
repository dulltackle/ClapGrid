import { PastePanel } from './paste-panel.js';
import { Button, Input, NativeSelect, ContextMenu, ContextMenuTrigger, ContextMenuItem } from '@/components/ui/index.js';
import { buildIdentity } from '../build-identity.js';
import { panelServiceUrl } from './service-url.js';
import { RowMenu } from './row-menu.js';
import { DeleteConfirm } from './delete-confirm.js';
import { AudioHistoryPanel, AudioListeningPanel } from './audio-panels.js';
import { DetailPanel } from './detail-panel.js';
import { VoicePanel } from './voice-panel.js';
import { dialogReturnFocus } from './dialog-focus.js';
import { ExportTaskDetails, exportStateLabel, useExportTasks } from './export-tasks.js';
import { ExportSettingsPanel } from './export-settings.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus, querySpeech, submitSpeech, setVoice, importVideo, saveSegment, beginEdit, connectTable, modifyUserBatch, type TableSession } from '../shared/client.js';
import type { Segment, ServiceStatus, SpeechStatus, Voice, Batch } from '../shared/contracts.js';
import { projectEditing } from './project-editing.js';
import { SearchText, textMatches } from './text-search.js';
import { TextEditor } from './text-editor.js';
import './style.css';
import { useSegmentDrag } from './segment-drag.js';

// 页面与表格共享语义变量；固定亮色，不跟随宿主主题。
const theme = themeQuartz.withParams({
  browserColorScheme: 'light',
  accentColor: 'var(--color-accent)',
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-ink)',
  borderColor: 'var(--color-border)',
  headerBackgroundColor: 'var(--color-surface-subtle)',
  headerTextColor: 'var(--color-ink-secondary)',
  rowHoverColor: 'var(--color-hover)',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--font-size-ui)',
  spacing: 'var(--space-1)',
  borderRadius: 'var(--radius-control)',
  wrapperBorderRadius: 'var(--radius-panel)',
  headerHeight: 40,
  rowHeight: 80,
});

// 行内控件拥有鼠标事件；普通状态文字仍采用表格原生整行选择。
const cellControlMouse = ({ event }: { event: Event }) =>
  event.target instanceof Element && !!event.target.closest('button, input, textarea, select, a, [contenteditable="true"]');

// AG Grid 默认处理 Tab/Enter；单元格内的原生按钮需要自己的键盘路径。
const cellControlKeyboard: NonNullable<ColDef<Segment>['suppressKeyboardEvent']> = ({ event }) => {
  const target = event.target as HTMLElement;
  if (target.closest('button') && ['Enter', ' '].includes(event.key)) return true;
  if (event.key !== 'Tab') return false;
  const cell = target.closest('[role="gridcell"]');
  const buttons = [...(cell?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const current = buttons.indexOf(target as HTMLButtonElement);
  const next = current + (event.shiftKey ? -1 : 1);
  if (next < 0 || next >= buttons.length) return false;
  event.preventDefault(); buttons[next]!.focus(); return true;
};

function SearchCell({ value, data, query, activeId, visit, rowHeight }: { value?: string; data?: Segment; query: string; activeId: string | null; visit: number; rowHeight: number }) {
  return <SearchText text={value ?? ''} query={query} current={data?.id === activeId} visit={visit} rowHeight={rowHeight} />;
}

function EmptyProject({ message }: { message: string }) { return <span>{message}</span>; }

export function App() {
  const [editing] = useState(() => projectEditing(() => beginEdit(panelServiceUrl())));
  const editState = useSyncExternalStore(editing.subscribe, editing.getState);
  const [detail, setDetail] = useState<'more' | 'voice' | 'paste' | 'tasks' | 'diagnostics' | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const exports = useExportTasks(() => { void editing.refresh(() => queryStatus(panelServiceUrl()), setStatus, () => {}); });
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>();
  const [reorderPreview, setReorderPreview] = useState<Segment[] | null>(null);
  const [speech, setSpeech] = useState<SpeechStatus>();
  const [listening, setListening] = useState<SpeechStatus['audio'][number] | null>(null);
  const [videoDetails, setVideoDetails] = useState<string | null>(null);
  const [audioHistory, setAudioHistory] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [videoEditor, setVideoEditor] = useState<{ segment: Segment; assetId: string; start: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [preview, setPreview] = useState<{ assetId: string; start: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchAnchor = useRef(0);
  const [paste, setPaste] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rowMenu, setRowMenu] = useState<{ anchor: Segment; expectedIds: string[] } | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const menuRestore = useRef(true);
  const [deleteTargets, setDeleteTargets] = useState<Segment[] | null>(null);
  const rowOrigin = useRef(() => {});
  const [selectionState, setSelectionState] = useState('正在连接勾选…');
  const [connectionVersion, setConnectionVersion] = useState(0);
  const table = useRef<TableSession | null>(null);
  const selectionVersion = useRef(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [saveError, setSaveError] = useState('');
  const grid = useRef<GridApi<Segment> | null>(null);
  const tableFallback = useRef<HTMLButtonElement>(null);
  const gridElement = useRef<HTMLDivElement>(null);
  const [searchRowHeight, setSearchRowHeight] = useState(240);
  const matchingIds = new Set(status?.snapshot.segments.filter(segment => textMatches(segment.text, query).length > 0).map(segment => segment.id));
  const matchedIds = displayOrder.filter(id => matchingIds.has(id));
  const activeMatch = searchOpen && currentMatch && matchedIds.includes(currentMatch) ? currentMatch : null;
  const searchLayout = useRef({ activeMatch, rowHeight: searchRowHeight });
  searchLayout.current = { activeMatch, rowHeight: searchRowHeight };
  const closeSearch = () => { setSearchOpen(false); setCurrentMatch(null); requestAnimationFrame(() => tableFallback.current?.focus()); };
  const locate = (needle: string, direction: -1 | 1, restart = false) => {
    const api = grid.current;
    if (!api || api.getEditingCells().length) return;
    const rows: { id: string; index: number }[] = [];
    api.forEachNodeAfterFilterAndSort(node => {
      if (node.data && node.rowIndex != null && textMatches(node.data.text, needle).length) rows.push({ id: node.data.id, index: node.rowIndex });
    });
    const current = rows.findIndex(row => row.id === currentMatch);
    const anchor = currentMatch ? api.getRowNode(currentMatch)?.rowIndex ?? searchAnchor.current : searchAnchor.current;
    const target = restart ? rows[0] : current >= 0 ? rows[(current + direction + rows.length) % rows.length]
      : direction === 1 ? rows.find(row => row.index >= anchor) ?? rows[0] : [...rows].reverse().find(row => row.index < anchor) ?? rows.at(-1);
    setCurrentMatch(target?.id ?? null); setVisit(value => value + 1);
    if (target) {
      searchAnchor.current = target.index;
      requestAnimationFrame(() => {
        if (api.isDestroyed() || api.getEditingCells().length) return;
        const node = api.getRowNode(target.id);
        if (node?.rowIndex != null) { api.ensureColumnVisible('text'); api.ensureIndexVisible(node.rowIndex, 'middle'); }
      });
    }
  };
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    // 失效命中只清除当前标记；定位只由用户输入或跳转触发。
    if (currentMatch && !matchedIds.includes(currentMatch)) setCurrentMatch(null);
  }, [currentMatch, matchedIds.join('\0')]);
  useEffect(() => {
    const element = gridElement.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSearchRowHeight(Math.max(44, Math.min(240, element.clientHeight - 56))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { grid.current?.resetRowHeights(); }, [activeMatch, searchRowHeight]);
  const returnFocus = useRef({ settings: () => {}, history: () => {}, audio: () => {}, video: () => {}, preview: () => {}, material: () => {}, detail: () => {} });
  const rememberOrigin = (trigger: HTMLElement, detail: keyof typeof returnFocus.current) => {
    returnFocus.current[detail] = dialogReturnFocus(trigger, () => grid.current, () => searchInput.current ?? (tableFallback.current?.hidden ? moreButton.current : tableFallback.current));
  };
  const openDetail = (next: typeof detail, trigger: HTMLElement) => { rememberOrigin(trigger, 'detail'); setDetail(next); };
  const failed = (cause: Error) => { setSaveState('failed'); setSaveError(cause.message); };
  const disconnected = () => {
    setVideoEditor(null); setImporting(false);
    grid.current?.stopEditing(true);
    failed(new Error('编辑连接已断开，未提交输入已取消；请重新读取后编辑。'));
  };
  const startEdit = (id: string) => editing.begin('segments', next => {
    flushSync(() => { setStatus(next); setError(''); setSaveError(''); setSaveState('saved'); });
    const row = grid.current?.getRowNode(id);
    if (row?.rowIndex == null) throw new Error('口播片段已删除，请选择其他片段。');
    grid.current?.startEditingCell({ rowIndex: row.rowIndex, colKey: 'text' });
  }, disconnected, cause => {
    if (cause.message === 'Codex 正在修改' || cause.message === '用户正在编辑') {
      setSaveState('saved');
      queueMicrotask(() => { void editing.refresh(() => queryStatus(panelServiceUrl()), setStatus, () => {}); });
    } else failed(cause);
  });
  const columns: ColDef<Segment>[] = [
    { headerName: '序号', field: 'order', width: 100, suppressKeyboardEvent: cellControlKeyboard, cellRendererParams: { suppressMouseEventHandling: cellControlMouse }, cellRenderer: ({ data }: { data?: Segment }) => data && <span className="flex h-full items-center gap-2"><button className="rounded-md border border-solid border-input bg-background text-foreground hover:bg-ui-accent shrink-0 cursor-grab touch-none p-[3px] leading-5 opacity-0 [.ag-row-hover_&]:opacity-100 focus-visible:opacity-100 active:cursor-grabbing disabled:opacity-0 [.ag-row-hover_&]:disabled:opacity-50" aria-label={`拖动片段 ${data.order}`} disabled={disabled} onPointerDownCapture={event => drag.start(event, data.id)} onClick={event => event.stopPropagation()}>⠿</button><span>{data.order}</span></span> },
    { headerName: '文案', field: 'text', flex: 1, minWidth: 200, editable: () => editing.getState().owner === 'segments' && editing.getState().editing && saveState !== 'saving' && !error,
      cellRenderer: SearchCell,
      cellRendererParams: { query: searchOpen ? query : '', activeId: activeMatch, visit, rowHeight: searchRowHeight },
      cellEditor: TextEditor, cellEditorPopup: true,
      suppressKeyboardEvent: params => {
        if (params.editing && params.event.key === 'Tab') { params.api.stopEditing(); return true; }
        return !params.editing && (['Enter', 'F2', 'Backspace', 'Delete'].includes(params.event.key) || params.event.key.length === 1);
      } },
    { headerName: '画面素材', initialWidth: 230, minWidth: 180, suppressKeyboardEvent: cellControlKeyboard, cellRendererParams: { suppressMouseEventHandling: cellControlMouse }, cellRenderer: (params: { data?: Segment }) => {
      const segment = params.data;
      if (!segment) return null;
      const asset = status?.snapshot.assets.find(asset => asset.id === segment.video?.assetId);
      return <div className="flex h-full items-center gap-2 leading-5">
        {asset && <button className="h-8 w-[52px] shrink-0 cursor-pointer overflow-hidden rounded-md border border-solid border-input bg-background p-0 text-foreground hover:bg-ui-accent" aria-label={`播放 ${asset.name}`} onClick={event => { rememberOrigin(event.currentTarget, 'preview'); setPreview(segment.video); }}>
          <img src={`${panelServiceUrl()}/api/media/${asset.id}/thumbnail`} alt="" className="h-full w-full object-contain" />
        </button>}
        <span className="min-w-0 flex-1 truncate">{asset ? asset.name : '未关联视频'}</span>
        <Button variant="outline" size="xs" className="border-solid border-input px-[6px] py-0 text-[12px] leading-[18px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2" aria-label={`查看片段 ${segment.order} 的画面素材详情`} onClick={event => { rememberOrigin(event.currentTarget, 'material'); setVideoDetails(segment.id); }}>详情</Button>
      </div>;
    } },
    { headerName: '配音', initialWidth: 290, minWidth: 290, suppressKeyboardEvent: cellControlKeyboard, cellRendererParams: { suppressMouseEventHandling: cellControlMouse }, cellRenderer: (params: { data?: Segment }) => {
      const segment = params.data; if (!segment) return null;
      const tasks = speech?.tasks.filter(task => task.segmentId === segment.id) ?? [];
      const latest = tasks.at(-1);
      const taskLabel = latest ? { accepted: '已受理', running: '生成中', succeeded: '生成成功', failed: '生成失败', unknown: '结果未知，可能已计费' }[latest.state] : '未生成';
      const recordings = speech?.audio.filter(audio => audio.segmentId === segment.id) ?? [];
      const audio = recordings.filter(audio => audio.valid).at(-1) ?? recordings.at(-1);
      return <div className="flex h-full flex-col justify-center gap-[2px] whitespace-normal leading-[18px]">
        <div role="group" aria-label="配音状态" className="flex min-w-0 flex-col leading-[18px]">
          <span>{audio ? audio.valid ? '有效配音' : '配音待更新' : '配音缺失'}</span>
          {latest && latest.state !== 'succeeded' && <span className={`text-[12px] ${latest.state === 'failed' || latest.state === 'unknown' ? 'text-destructive' : 'text-muted-foreground'}`}>最近任务：{taskLabel}</span>}
        </div>
        <div role="group" aria-label="配音操作" className="flex gap-1"><Button variant="outline" size="xs" className="border-solid border-input px-[6px] py-0 text-[12px] leading-[18px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2" disabled={disabled || !segment.text.trim()} onClick={() => { void generateSpeech(segment.id); }}>{latest?.state === 'failed' || latest?.state === 'unknown' ? '重试配音' : latest ? '重新生成' : '生成配音'}</Button>
        {audio && <Button variant="outline" size="xs" className="border-solid border-input px-[6px] py-0 text-[12px] leading-[18px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2" onClick={event => { rememberOrigin(event.currentTarget, 'audio'); setListening(audio); }}>试听{audio.valid ? '' : '（待更新）'}</Button>}
        <Button variant="outline" size="xs" className="border-solid border-input px-[6px] py-0 text-[12px] leading-[18px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2" aria-label={`展开片段 ${segment.order} 的保留音频`} onClick={event => { rememberOrigin(event.currentTarget, 'history'); setAudioHistory(segment.id); }}>详情</Button></div>
      </div>;
    } },
    { headerName: '画面说明', width: 180 },
  ];
  const generateSpeech = (segmentId: string) => editing.run(async action => {
    if (!status) return;
    setSaveError('');
    // 请求标识在提交前保存；断线或刷新后同一按钮复用，避免重复付费。
    const storageKey = `clapgrid-speech:${status.snapshot.project.id}:${segmentId}`;
    const requestId = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, requestId);
    await submitSpeech(panelServiceUrl(), { requestId, segmentId });
    localStorage.removeItem(storageKey);
    const next = await querySpeech(panelServiceUrl());
    action.apply(() => { setSaveError(''); setSaveState('saved'); setSpeech(next); });
  }, failed);
  const changeVoice = (voice: Voice) => editing.run(async action => {
    setSaveError('');
    await setVoice(panelServiceUrl(), voice);
    const next = await querySpeech(panelServiceUrl());
    action.apply(() => { setSpeech(next); setSaveState('saved'); });
  }, failed);
  const save = (change: { id?: string; text: string }) => editing.save('segments', { acquire: !change.id }, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    const next = await saveSegment(panelServiceUrl(), change, token);
    action.apply(() => { setStatus(next); setError(''); setSaveState('saved'); });
  }, cause => failed(new Error(`保存失败：${cause.message}`)));
  const organize = (batch: Batch) => editing.save('segments', { acquire: true }, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    const result = await modifyUserBatch(panelServiceUrl(), batch, token);
    action.apply(() => { setStatus(result.status); setError(''); });
    const unsuccessful = result.results.filter(item => item.outcome !== 'applied');
    if (unsuccessful.length) throw new Error(unsuccessful.map(item => item.message).join('；'));
    action.apply(() => {
      setSaveState('saved');
      if (batch.changes.some(change => change.kind === 'paste')) setPaste('');
    });
  }, failed);
  const openVideoEditor = (id?: string) => {
    const origin = document.activeElement;
    const originLayer = origin?.closest('[role="dialog"]');
    const stillRequested = () => id
      ? !!originLayer?.isConnected && originLayer.contains(document.activeElement)
      : document.activeElement === document.body || document.activeElement === moreButton.current || document.activeElement === origin;
    return editing.begin('segments', next => {
      if (!stillRequested()) { void editing.cancel('segments'); return; }
      setStatus(next); setSaveError(''); setSaveState('saved');
      if (id) {
        const segment = next.snapshot.segments.find(segment => segment.id === id);
        if (!segment) throw new Error('口播片段已删除');
        setVideoEditor({ segment, assetId: segment.video?.assetId ?? '', start: String(segment.video?.start ?? 0) });
      } else { setSourcePath(''); setImporting(true); }
    }, disconnected, cause => {
      failed(cause);
      requestAnimationFrame(() => { if (stillRequested()) returnFocus.current.video(); });
    });
  };
  const cancelVideo = () => {
    setVideoEditor(null); setImporting(false); setSaveState('saved');
    void editing.cancel('segments');
  };
  const saveVideo = () => editing.save('segments', {}, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    try {
      if (importing) {
        const result = await importVideo(panelServiceUrl(), sourcePath, token, action.signal);
        action.apply(() => setStatus(result.status));
      } else if (videoEditor) {
        if (!videoEditor.start.trim()) throw new Error('请填写视频起点');
        const result = await modifyUserBatch(panelServiceUrl(), { changes: [{ kind: 'video', expected: videoEditor.segment,
          assetId: videoEditor.assetId || null, start: Number(videoEditor.start) }] }, token, action.signal);
        action.apply(() => setStatus(result.status));
        if (result.summary.applied !== 1) throw new Error(result.results[0]?.message ?? '关联未保存');
      }
      action.apply(() => setSaveState('saved'));
    } finally { action.apply(() => { setVideoEditor(null); setImporting(false); }); }
  }, failed);
  const synchronizeSelection = (ids: string[]) => {
    setSelectedIds(ids);
    const connection = table.current;
    if (!connection) return;
    setSelectionState('正在同步勾选…');
    const version = ++selectionVersion.current;
    void connection.select(ids).then(() => {
      if (table.current === connection && version === selectionVersion.current) setSelectionState('勾选已同步');
    }).catch(() => {
      if (table.current !== connection) return;
      table.current = null; void connection.close();
      grid.current?.deselectAll(); setSelectedIds([]);
      setSelectionState('勾选连接已断开，请重新连接');
    });
  };
  useEffect(() => {
    let active = true;
    let connection: TableSession | undefined;
    setSelectionState('正在连接勾选…');
    void connectTable(panelServiceUrl()).then(next => {
      if (!active) { void next.close(); return; }
      connection = next; table.current = next;
      grid.current?.deselectAll(); setSelectedIds([]); setSelectionState('勾选已同步');
      void next.closed.then(() => {
        if (!active || table.current !== next) return;
        table.current = null; grid.current?.deselectAll(); setSelectedIds([]);
        setSelectionState('勾选连接已断开，请重新连接');
      });
    }).catch(() => { if (active) setSelectionState('勾选连接已断开，请重新连接'); });
    const leave = () => { if (connection) { table.current = null; void connection.close(); } };
    window.addEventListener('pagehide', leave);
    return () => { active = false; window.removeEventListener('pagehide', leave); leave(); };
  }, [connectionVersion]);
  useEffect(() => {
    editing.activate();
    const refresh = () => editing.refresh(
      () => Promise.all([queryStatus(panelServiceUrl()), querySpeech(panelServiceUrl())]),
      ([next, nextSpeech]) => { setStatus(next); setSpeech(nextSpeech); setError(''); },
      cause => { setStatus(undefined); setError(`服务连接失败：${cause.message}。请关闭重开 ClapGrid 并核对当前工作空间。`); },
    );
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    const leave = () => editing.deactivate();
    const resume = () => { editing.activate(); void refresh(); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', resume); editing.deactivate(); };
  }, [editing]);
  const disabled = !status || !speech || speech.locked || status.taskLocked || editState.busy || editState.editing || !!status.modification;
  const drag = useSegmentDrag({ segments: status?.snapshot.segments ?? [], disabled, grid, element: gridElement,
    submit: (expectedIds, ids) => {
      if (!status || editing.getState().busy || editing.getState().editing) return;
      // 松手立即反馈位置；预览不覆盖服务快照，失败或取消后恢复已确认顺序。
      const segments = new Map(status.snapshot.segments.map(segment => [segment.id, segment]));
      setReorderPreview(ids.map((id, index) => ({ ...segments.get(id)!, order: index + 1 })));
      setSaveState('saving'); setSaveError('');
      void organize({ changes: [{ kind: 'reorder', expectedIds, ids }] }).finally(() => setReorderPreview(null));
    },
    reject: message => failed(new Error(message)),
  });
  const requestDelete = () => {
    const ids = grid.current?.getSelectedRows().map(segment => segment.id) ?? [];
    const targets = status?.snapshot.segments.filter(segment => ids.includes(segment.id)) ?? [];
    if (!targets.length || disabled) return;
    menuRestore.current = false; setDeleteTargets(structuredClone(targets)); setRowMenuOpen(false);
  };
  const insertRelative = async (placement: 'before' | 'after') => {
    if (!rowMenu || selectedIds.length !== 1 || disabled || editing.getState().busy || editing.getState().editing) return;
    const relative = { anchor: rowMenu.anchor, expectedIds: rowMenu.expectedIds, placement };
    menuRestore.current = false; setRowMenuOpen(false);
    let inserted: string | undefined;
    await editing.save('segments', { acquire: true }, async (token, action) => {
      setSaveState('saving'); setSaveError('');
      const result = await modifyUserBatch(panelServiceUrl(), { changes: [{ kind: 'add', text: '', relative }] }, token, action.signal);
      action.apply(() => { flushSync(() => setStatus(result.status)); });
      const item = result.results[0];
      if (item?.outcome !== 'applied' || !item.id) throw new Error(item?.message ?? '未能确认新增口播片段');
      action.apply(() => {
        inserted = item.id; setSaveState('saved');
        const node = grid.current?.getRowNode(item.id!);
        if (node?.rowIndex != null) { node.setSelected(true, true); grid.current?.ensureColumnVisible('text'); grid.current?.ensureIndexVisible(node.rowIndex, 'middle'); }
      });
    }, cause => { failed(cause); requestAnimationFrame(() => rowOrigin.current()); });
    if (inserted) await startEdit(inserted);
  };
  const currentListening = speech?.audio.find(audio => audio.taskId === listening?.taskId && audio.segmentId === listening?.segmentId);
  const speechTask = speech?.tasks.at(-1);
  const speechProblems = speech?.tasks.filter(task => task.state === 'failed' || task.state === 'unknown') ?? [];
  const batchTask = speech?.operations.at(-1);
  const exportTask = exports.exports?.tasks.at(-1);
  const exportProblems = exports.exports?.tasks.filter(task => task.state === 'failed' || task.state === 'interrupted') ?? [];
  const lock = speech?.locked ? '配音进行中，项目已锁定；可查询和试听' : status?.taskLocked || exports.exports?.locked ? '导出进行中，项目已锁定' : status?.modification?.owner === 'codex' ? 'Codex 正在修改' : status?.modification?.owner === 'user' ? '用户正在编辑' : '';
  const searchStatus = !query ? '输入文案查找' : !matchedIds.length ? '无匹配片段' : activeMatch ? `第 ${matchedIds.indexOf(activeMatch) + 1} / ${matchedIds.length} 个匹配片段` : `${matchedIds.length} 个匹配片段，点击下一个定位`;
  return <main className="mx-auto flex h-dvh min-w-0 max-w-[1600px] flex-col gap-2 px-4 py-3 max-[600px]:p-2">
    <header className={`flex h-8 min-h-8 flex-none flex-nowrap items-center justify-between max-[600px]:gap-1 ${searchOpen ? 'gap-1' : 'gap-3'}`}>
      <h1 className="m-0 flex-none text-[18px] leading-normal font-semibold" hidden={searchOpen}>口播片段</h1>
      {searchOpen && <section id="segment-search" className="search-popover flex h-8 min-w-0 flex-1 items-center gap-1" role="dialog" aria-modal="false" aria-label="查找口播片段">
        <label className="min-w-[72px] flex-1"><Input className="h-6 px-1.5 py-0.5 text-[12px] md:text-[12px]" ref={searchInput} aria-label="查找文案" placeholder="查找文案" value={query}
          onChange={event => { setQuery(event.target.value); locate(event.target.value, 1, true); }}
          onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } else if (event.key === 'Enter') { event.preventDefault(); locate(query, event.shiftKey ? -1 : 1); } }} /></label>
        <span className="min-w-0 flex-[0_1_116px] overflow-hidden text-[11px] text-muted-foreground text-ellipsis whitespace-nowrap" role="status" aria-label={searchStatus} title={searchStatus}>{searchStatus}</span>
        <div className="flex flex-none flex-nowrap items-center gap-0.5">
          <Button variant="outline" size="xs" className="border-input text-foreground px-1 py-0.5 text-[11px]" disabled={!matchedIds.length} onClick={() => locate(query, -1)}>上一个</Button>
          <Button variant="outline" size="xs" className="border-input text-foreground px-1 py-0.5 text-[11px]" disabled={!matchedIds.length} onClick={() => locate(query, 1)}>下一个</Button>
          <Button variant="outline" size="xs" className="border-input text-foreground px-1 py-0.5 text-[11px]" onClick={closeSearch}>关闭查找</Button>
        </div>
      </section>}
      <div className="flex flex-none flex-nowrap items-center gap-2 max-[600px]:gap-1">
        <Button variant="outline" size="sm" className="border-input text-foreground max-[600px]:px-2" hidden={searchOpen} disabled={disabled} onClick={() => { void save({ text: '' }); }}>新增口播片段</Button>
        <Button variant="outline" size="sm" className="search-trigger border-input text-foreground max-[600px]:px-2" hidden={searchOpen} ref={tableFallback} aria-expanded={searchOpen} aria-controls="segment-search" onClick={() => { setSearchOpen(true); locate(query, 1, true); }}>查找</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground max-[600px]:px-2" hidden={searchOpen} disabled={!status || !!error || exports.busy || !exports.exports || exports.exports.locked} aria-describedby="export-scope" title="全片导出：查找与勾选不改变范围" onClick={() => { void exports.run(); }}>导出全片</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground max-[600px]:px-2" ref={moreButton} aria-haspopup="dialog" aria-expanded={detail === 'more'} onClick={event => openDetail('more', event.currentTarget)}>更多</Button>
      </div>
    </header>
    <p id="export-scope" className="sr-only">全片导出：查找与勾选不改变范围</p>
    {detail === 'more' && <DetailPanel title="更多操作" onClose={() => setDetail(null)} restoreFocus={() => returnFocus.current.detail()}>
      <div className="flex flex-col gap-2 mb-1">
        {searchOpen && <>
          <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled} onClick={() => { setDetail(null); void save({ text: '' }); }}>新增口播片段</Button>
          <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!status || !!error || exports.busy || !exports.exports || exports.exports.locked} aria-describedby="export-scope" onClick={() => { setDetail(null); void exports.run(); }}>导出全片</Button>
        </>}
        <p className="m-0 text-[12px] text-muted-foreground">全片导出：查找与勾选不改变范围</p>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled} onClick={() => { rememberOrigin(moreButton.current!, 'video'); setDetail(null); void openVideoEditor(); }}>导入本地视频</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled} onClick={() => setDetail('paste')}>粘贴多行文案</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!speech} onClick={() => setDetail('voice')}>声音设置</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!status} onClick={() => { rememberOrigin(moreButton.current!, 'settings'); setDetail(null); setExportSettingsOpen(true); }}>导出设置</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" onClick={() => setDetail('tasks')}>任务记录</Button>
      </div>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={() => setDetail(null)}>关闭</Button>
    </DetailPanel>}
    {detail === 'voice' && speech && <VoicePanel speech={speech} disabled={disabled} busy={editState.busy}
      error={saveState === 'failed' ? saveError : undefined} onChange={voice => { void changeVoice(voice); }}
      onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail} />}
    {detail === 'tasks' && <DetailPanel title="任务记录" onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail}>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={() => setDetail('diagnostics')}>连接诊断</Button>
      {speech && <section aria-label="配音任务" className="flex flex-col gap-2 [&_p]:my-2 [&_p]:text-[12px] [&_summary]:font-medium">
      {speech.operations.length > 0 && <section aria-label="批量配音进度" aria-live="polite">
        {speech.operations.slice().reverse().map(operation => <details key={operation.id} open={operation.summary.pending > 0}>
          <summary className="w-fit cursor-pointer rounded-md px-2 py-1 hover:bg-ui-accent active:bg-input">批量配音：完成 {operation.summary.completed} · 成功 {operation.summary.succeeded} · 失败 {operation.summary.failed} · 已中断 {operation.summary.interrupted} · 待完成 {operation.summary.pending} · 跳过 {operation.summary.skipped} · 拒绝 {operation.summary.rejected}</summary>
          <p>操作 {operation.id} · 请求 {operation.request.requestId}</p>
          {operation.results.map(item => <p key={item.segmentId}>片段 {status?.snapshot.segments.find(segment => segment.id === item.segmentId)?.order ?? item.segmentId}：{({ accepted: '已受理', existing: '已有任务', skipped: '已跳过', rejected: '被拒绝' })[item.outcome]} · {item.state ? ({ accepted: '尚未完成', running: '正在生成', succeeded: '成功', failed: '失败', unknown: '已中断／结果未知' })[item.state] : ''} · {item.message}</p>)}
        </details>)}
      </section>}
      {speech.tasks.length > 0 && <details open><summary className="w-fit cursor-pointer rounded-md px-2 py-1 hover:bg-ui-accent active:bg-input">配音任务与请求标识</summary>{speech.tasks.map(task => <p key={task.id}>任务 {task.id} · 请求 {task.requestId}：{task.message}</p>)}</details>}
        {!speech.tasks.length && <p>暂无配音任务</p>}
      </section>}
      <ExportTaskDetails controller={exports} />
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={() => setDetail(null)}>关闭任务记录</Button>
    </DetailPanel>}
    {detail === 'diagnostics' && <DetailPanel title="连接诊断" onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail}>
      <p className="m-0" role="status">{error || (status ? '本地服务已连接' : '正在连接本地服务…')}</p>
      {status && <dl className="m-0 rounded-md border border-solid border-input bg-muted p-3 text-[12px] [&_dt]:font-semibold [&_dd]:m-0 [&_dd]:mb-2 [&_dd:last-child]:mb-0">
        <dt>面板版本</dt><dd>{buildIdentity.state === 'known' ? `${buildIdentity.version} (${buildIdentity.contentFingerprint})` : '未知（开发构建或旧版本）'}</dd>
        <dt>服务版本</dt><dd>{status.buildIdentity?.state === 'known' ? `${status.buildIdentity.version} (${status.buildIdentity.contentFingerprint})` : '未知（开发构建或旧版本）'}</dd>
        <dt>版本核对</dt><dd>{buildIdentity.state === 'known' && status.buildIdentity?.state === 'known'
          ? buildIdentity.contentFingerprint === status.buildIdentity.contentFingerprint ? '面板与服务一致' : '版本不一致，请更新插件并重新打开'
          : '尚未验证版本一致性'}</dd>
        <dt>项目路径</dt><dd>{status.snapshot.project.directory}</dd>
        <dt>服务实例</dt><dd>{status.instanceId}</dd>
        <dt>PID</dt><dd>{status.pid}</dd>
      </dl>}
      <p className="m-0 text-[12px] text-muted-foreground">{selectionState}</p>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={() => setDetail(null)}>关闭诊断</Button>
    </DetailPanel>}
    {detail === 'paste' && <PastePanel value={paste} busy={editState.busy} disabled={disabled}
      error={saveState === 'failed' ? saveError : ''} onChange={setPaste}
      onSubmit={() => { void organize({ changes: [{ kind: 'paste', text: paste }] }); }}
      onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail} />}
    {exportSettingsOpen && status && <ExportSettingsPanel restoreFocus={returnFocus.current.settings} editing={editing} status={status} onStatus={setStatus} onSaveState={(state, message = '') => { setSaveState(state); setSaveError(message); }} onClose={() => setExportSettingsOpen(false)} />}
    {audioHistory && <AudioHistoryPanel segmentId={audioHistory} speech={speech} onClose={() => setAudioHistory(null)} restoreFocus={returnFocus.current.history} />}
    {listening && <AudioListeningPanel audio={listening} currentAudio={currentListening} onClose={() => setListening(null)} restoreFocus={returnFocus.current.audio}
      onError={() => { setSaveState('failed'); setSaveError('音频不可读取，请检查项目文件'); }} />}
    {videoDetails && <DetailPanel title="画面素材详情" label="画面素材详情" restoreWithinLayer className="[&_p]:m-0 [&_button]:self-start" onClose={() => setVideoDetails(null)} restoreFocus={returnFocus.current.material}>
      {(() => {
        const segment = status?.snapshot.segments.find(segment => segment.id === videoDetails);
        const asset = status?.snapshot.assets.find(asset => asset.id === segment?.video?.assetId);
        return segment ? <>
          <p>{asset?.name ?? '未关联视频'}</p>
          {asset && segment.video && <>
            <p>时长 {asset.duration.toFixed(2)} 秒 · 播放起点 {segment.video.start} 秒</p>
            <Button variant="outline" onClick={event => { rememberOrigin(event.currentTarget, 'preview'); setPreview(segment.video); }}>播放预览</Button>
          </>}
          <Button variant="outline" disabled={disabled} onClick={event => { rememberOrigin(event.currentTarget, 'video'); void openVideoEditor(segment.id); }}>{asset ? '更改' : '关联'}</Button>
          <p>当前支持关联一份本地视频；更改中可解除关联及调整播放起点。</p>
        </> : <p>口播片段已不存在。</p>;
      })()}
      <Button variant="outline" onClick={() => setVideoDetails(null)}>关闭详情</Button>
    </DetailPanel>}
    {(videoEditor || importing) && <DetailPanel title={importing ? '导入本地视频' : '关联视频'} label={importing ? '导入本地视频' : '关联视频'} restoreWithinLayer className="[&_p]:m-0 [&_button]:self-start" onClose={cancelVideo} restoreFocus={returnFocus.current.video}>
      {importing ? <label className="flex min-w-0 flex-col gap-1">视频文件绝对路径<Input aria-label="视频文件绝对路径" value={sourcePath} disabled={saveState === 'saving'} onChange={event => setSourcePath(event.target.value)} placeholder="粘贴要导入的本地视频完整路径" /></label>
        : videoEditor && <>
          <label className="flex min-w-0 flex-col gap-1">素材<NativeSelect aria-label="关联素材" value={videoEditor.assetId} disabled={saveState === 'saving'} onChange={event => setVideoEditor({ ...videoEditor, assetId: event.target.value, start: '0' })}>
            <option value="">解除关联</option>
            {status?.snapshot.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}（{asset.duration.toFixed(2)} 秒）</option>)}
          </NativeSelect></label>
          <label className="flex min-w-0 flex-col gap-1">播放起点（秒）<Input aria-label="播放起点（秒）" type="number" min="0" step="any" disabled={!videoEditor.assetId || saveState === 'saving'} value={videoEditor.start} onChange={event => setVideoEditor({ ...videoEditor, start: event.target.value })} /></label>
          {!status?.snapshot.assets.length && <p>请先取消并导入本地视频。</p>}
        </>}
      {importing && <p>只读取指定文件，复制到项目并生成静音预览。原文件之后可移动或改名。</p>}
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={saveState === 'saving' || (importing && !sourcePath.trim())} onClick={() => { void saveVideo(); }}>{saveState === 'saving' ? '正在处理…' : importing ? '导入并复制' : '保存关联与起点'}</Button>
        <Button variant="outline" onClick={() => { void cancelVideo(); }}>取消</Button></div>
    </DetailPanel>}
    {preview && <DetailPanel title="视频预览" label="视频预览" restoreWithinLayer className="[&_p]:m-0 [&_button]:self-start" onClose={() => setPreview(null)} restoreFocus={returnFocus.current.preview}>
      <video className="block w-full max-h-[60dvh] shrink-0" key={preview.assetId} controls muted autoPlay src={`${panelServiceUrl()}/api/media/${preview.assetId}/preview`} onLoadedMetadata={event => { event.currentTarget.currentTime = preview.start; }} onError={() => { setSaveError('预览不可用，请检查项目素材文件'); setSaveState('failed'); }} />
      <p>从 {preview.start} 秒开始，预览默认静音。</p><Button variant="outline" onClick={() => setPreview(null)}>关闭预览</Button>
    </DetailPanel>}
    {deleteTargets && <DeleteConfirm count={deleteTargets.length} disabled={disabled} lock={lock}
      onClose={() => setDeleteTargets(null)} restoreFocus={() => rowOrigin.current()}
      onConfirm={() => {
        if (disabled || editing.getState().busy || editing.getState().editing) return;
        const targets = deleteTargets;
        // 结果先落到表格，再关闭并按稳定身份恢复；避免返回即将删除的旧 DOM。
        void organize({ changes: targets.map(expected => ({ kind: 'delete', expected })) }).finally(() => {
          setDeleteTargets(current => current === targets ? null : current);
        });
      }} />}
    <ContextMenu modal={false} open={rowMenuOpen} onOpenChange={setRowMenuOpen}>
    <ContextMenuTrigger asChild>
    <div className="segment-grid w-full min-w-0 flex-1 min-h-0" ref={gridElement} onContextMenuCapture={event => {
      // 编辑器的复制粘贴属于系统菜单：只阻止 Trigger 收到事件，不取消浏览器默认行为。
      if (editing.getState().editing || (event.target as HTMLElement).closest('input:not([type="checkbox"]), textarea, .ag-popup-editor')) {
        event.stopPropagation(); setRowMenuOpen(false);
      }
    }} onPointerDown={event => {
      // 长按不能绕过行身份检查；当前行菜单仅从真实 contextmenu 事件打开。
      if (event.pointerType !== 'mouse') event.preventDefault();
    }} onContextMenu={event => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[row-id]');
      const node = row?.getAttribute('row-id') ? grid.current?.getRowNode(row.getAttribute('row-id')!) : null;
      if (!node?.data || editing.getState().editing || target.closest('input:not([type="checkbox"]), textarea, .ag-popup-editor')) { event.preventDefault(); setRowMenuOpen(false); return; }
      menuRestore.current = true;
      if (!node.isSelected()) node.setSelected(true, true);
      rowOrigin.current = dialogReturnFocus(target, () => grid.current, () => moreButton.current);
      setRowMenu({ anchor: structuredClone(node.data), expectedIds: status?.snapshot.segments.map(segment => segment.id) ?? [] });
    }} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], .ag-popup-editor') || editing.getState().editing) return;
      event.preventDefault();
      grid.current?.deselectAll();
    }}>{drag.indicator}<AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      animateRows={!searchOpen}
      readOnlyEdit stopEditingWhenCellsLoseFocus suppressClickEdit popupParent={document.body}
      rowSelection={{ mode: 'multiRow', selectAll: 'all', enableClickSelection: true }}
      onSelectionChanged={event => synchronizeSelection(event.api.getSelectedRows().map(segment => segment.id))}
      onGridReady={event => { grid.current = event.api; }}
      onModelUpdated={event => {
        const ids: string[] = []; event.api.forEachNodeAfterFilterAndSort(node => { if (node.data) ids.push(node.data.id); });
        setDisplayOrder(previous => previous.join('\0') === ids.join('\0') ? previous : ids);
        if (currentMatch) { const index = event.api.getRowNode(currentMatch)?.rowIndex; if (index != null) searchAnchor.current = index; }
      }}
      getRowHeight={params => params.data?.id === searchLayout.current.activeMatch ? searchLayout.current.rowHeight : 80}
      onCellDoubleClicked={event => { if (event.colDef.field === 'text' && event.data) void startEdit(event.data.id); }}
      onCellKeyDown={event => {
        const key = (event.event as KeyboardEvent).key;
        if ('colDef' in event && event.colDef.field === 'text' && event.data && !editing.getState().editing && (['Enter', 'F2'].includes(key) || key.length === 1)) void startEdit(event.data.id);
      }}
      getRowId={params => params.data.id}
      onCellEditingStopped={() => editing.finishCell()}
      onCellEditRequest={event => { void save({ id: event.data.id, text: String(event.newValue ?? '') }); }}
      theme={theme} loading={!status && !error} columnDefs={columns} rowData={reorderPreview ?? status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      noRowsOverlayComponent={EmptyProject}
      noRowsOverlayComponentParams={{ message: error ? '暂时无法读取口播片段' : '暂无口播片段' }} /></AgGridProvider></div>
    </ContextMenuTrigger>
    {rowMenu && <RowMenu onCloseAutoFocus={event => {
      event.preventDefault();
      if (menuRestore.current) rowOrigin.current();
    }} onInteractOutside={() => { menuRestore.current = false; }}>
      <ContextMenuItem disabled={disabled || !selectedIds.length} onSelect={requestDelete}>删除口播片段</ContextMenuItem>
      <ContextMenuItem disabled={disabled || selectedIds.length !== 1} onSelect={() => { void insertRelative('before'); }}>上方添加</ContextMenuItem>
      <ContextMenuItem disabled={disabled || selectedIds.length !== 1} onSelect={() => { void insertRelative('after'); }}>下方添加</ContextMenuItem>
    </RowMenu>}
    </ContextMenu>
    <footer className="flex-none border-0 border-t border-solid border-input pt-2 text-[12px] text-muted-foreground [&_p]:m-0 [&_p]:wrap-anywhere" aria-label="项目状态">
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5" role="status">
        <span className="flex-none">{error ? '服务连接失败' : status ? '本地服务已连接' : '正在连接本地服务…'}</span>
        <span data-save-status className={`flex-none ${saveState === 'failed' ? 'text-destructive' : ''}`}>{saveState === 'saving' ? '保存中…' : saveState === 'failed' ? '保存失败' : status ? '已保存' : '等待读取项目'}</span>
        <span className="min-w-0 flex-1 truncate">{batchTask && batchTask.summary.pending > 0 ? `配音 ${batchTask.summary.completed}/${batchTask.summary.completed + batchTask.summary.pending}` : speechTask && (speechTask.state === 'running' || speechTask.state === 'accepted') ? '配音生成中' : exportTask && exports.exports?.locked ? `${exportStateLabel[exportTask.state]} ${exportTask.completed}/${exportTask.total}` : ''}</span>
        <Button variant="outline" size="xs" className="border-input text-foreground px-1.5 py-0.5 text-[12px]" onClick={event => openDetail('tasks', event.currentTarget)}>任务详情</Button>
      </div>
      {lock && <p className="pt-1" role="status">{lock}</p>}
      {(error || saveError || exports.connectionError || exports.operationError || speechProblems.length > 0 || exportProblems.length > 0 || selectionState.includes('断开')) && <div className="max-h-[22dvh] overflow-auto bg-[var(--color-error-surface)] text-destructive" aria-label="操作异常">
        {error && <p role="alert">{error}</p>}
        {saveError && <p role={saveState === 'failed' ? 'alert' : 'status'}>{saveError}</p>}
        {exports.connectionError && <p role="alert">{exports.connectionError}</p>}
        {exports.operationError && <p role="alert">{exports.operationError}</p>}
        {speechProblems.length > 0 && <p role="alert">配音异常 {speechProblems.length} 项{speechProblems.some(task => task.state === 'unknown') ? ' · 结果未知，可能已计费' : ' · 生成失败'}，请查看任务详情</p>}
        {exportProblems.length > 0 && <p role="alert">导出失败或中断 {exportProblems.length} 项，请查看任务详情</p>}
        {selectionState.includes('断开') && <p role="alert">{selectionState} <Button variant="outline" size="xs" className="border-input text-foreground px-1.5 py-0.5 text-[12px]" onClick={() => setConnectionVersion(version => version + 1)}>重新连接勾选</Button></p>}
      </div>}
    </footer>
  </main>;
}
