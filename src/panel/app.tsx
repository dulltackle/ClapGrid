import { SegmentRowCell, SegmentRowActions, SegmentOrderCell } from './segment-row.js';
import { SegmentDraftPrompt } from './segment-details.js';
import { SegmentRowDetails } from './segment-row-details.js';
import { PastePanel } from './paste-panel.js';
import { Button, Input, NativeSelect, ContextMenu, ContextMenuTrigger, ContextMenuItem, AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '@/components/ui/index.js';
import { buildIdentity } from '../build-identity.js';
import { panelServiceUrl } from './service-url.js';
import { RowMenu } from './row-menu.js';
import { DeleteConfirm } from './delete-confirm.js';
import { AudioHistoryPanel } from './audio-panels.js';
import { DetailPanel } from './detail-panel.js';
import { VoicePanel } from './voice-panel.js';
import { segmentFocusCoordinator, type FocusReturn } from './dialog-focus.js';
import { ExportTaskDetails, exportStateLabel, useExportTasks } from './export-tasks.js';
import { ExportSettingsPanel } from './export-settings.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus, querySpeech, submitSpeech, setVoice, importMaterial, renameMaterial, queryVisualPreviews, beginEdit, connectTable, modifyUserBatch, type TableSession } from '../shared/client.js';
import { MaterialDerivationDetails } from './material-derivation.js';
import { segmentMaterials } from '../shared/contracts.js';
import type { Segment, ServiceStatus, SpeechStatus, Voice, Batch, ExportTask, VideoAsset } from '../shared/contracts.js';
import { projectEditing } from './project-editing.js';
import { useSegmentInteraction, segmentTargets } from './segment-interaction.js';
import { segmentActions, segmentRowMenu } from './segment-actions.js';
import { segmentSpeech } from './speech-state.js';
import { segmentNavigation } from './segment-navigation.js';
import { textMatches } from './text-search.js';
import { TextEditor } from './text-editor.js';
import './style.css';
import { useSegmentDrag } from './segment-drag.js';
import { panelCompatibility, panelNeedsRefresh, panelRestoreKey, readPanelRestore, restoredSelection, useMediaBusy, usePanelActivity, writePanelRestore } from './panel-update.js';

// 页面与表格共享语义变量；固定亮色，不跟随宿主主题。
const theme = themeQuartz.withParams({
  browserColorScheme: 'light',
  accentColor: 'var(--color-accent)',
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-ink)',
  borderColor: 'var(--color-border)',
  headerBackgroundColor: 'color-mix(in srgb, var(--color-focus) 5%, white)',
  headerTextColor: 'var(--color-ink-secondary)',
  selectedRowBackgroundColor: '#f6faff',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--font-size-ui)',
  spacing: 'var(--space-1)',
  borderRadius: 'var(--radius-control)',
  wrapperBorderRadius: 'var(--radius-panel)',
  headerHeight: 38,
  rowHeight: 102,
  pinnedColumnBorder: false,
  columnBorder: false,
});

// 行内控件拥有鼠标事件；勾选只由明确的选择入口改变。
const cellControlMouse = ({ event }: { event: Event }) =>
  event.target instanceof Element && !!event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [data-segment-script]');

// AG Grid 默认处理 Tab/Enter；单元格内的原生按钮需要自己的键盘路径。
const cellControlKeyboard: NonNullable<ColDef<Segment>['suppressKeyboardEvent']> = ({ event }) => {
  const target = event.target as HTMLElement;
  if (target.closest('button') && ['Enter', ' '].includes(event.key)) return true;
  if (event.key === ' ' && !target.closest('input[type="checkbox"]')) return true;
  if (event.key !== 'Tab') return false;
  const cell = target.closest('[role="gridcell"]');
  const buttons = [...(cell?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
  const current = buttons.indexOf(target as HTMLButtonElement);
  const next = current + (event.shiftKey ? -1 : 1);
  if (next < 0 || next >= buttons.length) return false;
  event.preventDefault(); buttons[next]!.focus(); return true;
};

/** AG Grid 管理行间导航；行内按阅读顺序遍历，包括挂在虚拟行上的说明。 */
function rowControlTab(event: import('react').KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab' || event.nativeEvent.isComposing) return;
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>('.ag-row[row-id]');
  if (!row) return;
  const controls = (root: Element) => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, [data-note-original]')]
    .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
  const stops: HTMLElement[] = [];
  for (const cell of row.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
    stops.push(cell, ...controls(cell));
    if (cell.getAttribute('col-id') === 'text') {
      const note = row.querySelector('[role="region"][id^="segment-note-"]');
      if (note) stops.push(...controls(note));
    }
  }
  const index = stops.indexOf(target);
  if (index < 0) return;
  const next = stops[index + (event.shiftKey ? -1 : 1)];
  if (!next) return;
  event.preventDefault(); event.stopPropagation(); next.focus();
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
  const [inlineAudio, setInlineAudio] = useState<SpeechStatus['audio'][number] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const mediaBusy = useMediaBusy();
  const audioPlayer = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const coordinate = (event: Event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => { if (media !== event.target) media.pause(); });
    };
    document.addEventListener('play', coordinate, true);
    return () => document.removeEventListener('play', coordinate, true);
  }, []);
  const [speechRetryId, setSpeechRetryId] = useState<string | null>(null);
  const [audioHistory, setAudioHistory] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deletedDraftOpen, setDeletedDraftOpen] = useState(false);
  const [videoEditor, setVideoEditor] = useState<{ segment: Segment; index: number; assetId: string; start: string } | null>(null);
  const [assetRename, setAssetRename] = useState<{ asset: VideoAsset; name: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [importing, setImporting] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [trayId, setTrayId] = useState<string | null>(null);
  const [visualPreviews, setVisualPreviews] = useState<ExportTask[]>([]);
  const [composedPreview, setComposedPreview] = useState<ExportTask | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewAsset = status?.snapshot.assets.find(asset => asset.id === preview);
  const previewClose = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchAnchor = useRef(0);
  const [paste, setPaste] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [panelRestore, setPanelRestore] = useState(() => {
    try { return readPanelRestore(sessionStorage, panelRestoreKey(panelServiceUrl())); } catch { return null; }
  });
  const [panelUpdateError, setPanelUpdateError] = useState('');
  const restoringPanelSelection = useRef(false);
  const panelRestoreCancelled = useRef(false);
  const [panelReadyVersion, setPanelReadyVersion] = useState(0);
  const [rowMenu, setRowMenu] = useState<{ anchor: Segment; targets: Segment[]; expectedIds: string[]; origin: FocusReturn } | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const [rowActionMenuOpen, setRowActionMenuOpen] = useState(false);
  const menuRestore = useRef(true);
  const [deleteTargets, setDeleteTargets] = useState<{ targets: Segment[]; origin: FocusReturn } | null>(null);
  const [selectionState, setSelectionState] = useState('正在连接勾选…');
  const [connectionVersion, setConnectionVersion] = useState(0);
  const table = useRef<TableSession | null>(null);
  const selectionVersion = useRef(0);
  const [operationErrors, setOperationErrors] = useState<Partial<Record<'project' | 'speech' | 'voice' | 'video' | 'audio' | 'preview' | 'settings', string>>>({});
  const reportOperation = (kind: keyof typeof operationErrors, message = '') => setOperationErrors(previous => ({ ...previous, [kind]: message }));
  const grid = useRef<GridApi<Segment> | null>(null);
  const tableFallback = useRef<HTMLButtonElement>(null);
  const gridElement = useRef<HTMLDivElement>(null);
  const statusFooter = useRef<HTMLElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  useEffect(() => {
    const footer = statusFooter.current;
    if (!footer) return;
    const observer = new ResizeObserver(() => setFooterHeight(footer.offsetHeight + 8));
    observer.observe(footer); return () => observer.disconnect();
  }, []);
  const [searchRowHeight, setSearchRowHeight] = useState(240);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [noteHeight, setNoteHeight] = useState(120);
  const toggleNote = (id: string) => setExpandedNote(previous => previous === id ? null : id);
  const matchingIds = new Set(status?.snapshot.segments.filter(segment => textMatches(segment.text, query).length > 0).map(segment => segment.id));
  const matchedIds = displayOrder.filter(id => matchingIds.has(id));
  const activeMatch = searchOpen && currentMatch && matchedIds.includes(currentMatch) ? currentMatch : null;
  const searchLayout = useRef({ activeMatch, rowHeight: searchRowHeight, expandedNote, noteHeight });
  searchLayout.current = { activeMatch, rowHeight: searchRowHeight, expandedNote, noteHeight };
  useEffect(() => {
    if (trayId && !status?.snapshot.segments.some(segment => segment.id === trayId)) setTrayId(null);
  }, [status, trayId]);
  const mainRowHeight = (id?: string) => (id === searchLayout.current.activeMatch ? Math.max(102, searchLayout.current.rowHeight) : 102);
  useEffect(() => {
    if (expandedNote && status && !status.snapshot.segments.some(segment => segment.id === expandedNote)) setExpandedNote(null);
  }, [expandedNote, status]);
  const closeSearch = () => {
    focusReturns.cancelPending();
    const requested = focusReturns.intent();
    setSearchOpen(false); setCurrentMatch(null);
    requestAnimationFrame(() => { if (requested.valid()) tableFallback.current?.focus(); });
  };
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
  useEffect(() => { grid.current?.resetRowHeights(); }, [activeMatch, searchRowHeight, expandedNote, noteHeight]);
  const returnFocus = useRef({ draft: () => {}, settings: () => {}, history: () => {}, audio: () => {}, video: () => {}, preview: () => {}, detail: () => {} });
  const [focusReturns] = useState(() => segmentFocusCoordinator(() => grid.current, {
    search: () => searchInput.current, table: () => tableFallback.current, more: () => moreButton.current,
  }));
  useEffect(() => focusReturns.listen(), [focusReturns]);
  const rememberOrigin = (trigger: HTMLElement, detail: keyof typeof returnFocus.current) => {
    returnFocus.current[detail] = focusReturns.capture(trigger);
  };
  const openDetail = (next: typeof detail, trigger: HTMLElement) => { rememberOrigin(trigger, 'detail'); setDetail(next); };
  const closeDetail = () => focusReturns.close(returnFocus.current.detail, () => setDetail(null));
  const failed = (cause: Error) => reportOperation('project', cause.message);
  const disconnected = () => {
    focusReturns.close(returnFocus.current.video, () => { setVideoEditor(null); setImporting(false); });
    reportOperation('video', '编辑连接已断开，请重新打开视频关联后重试。');
  };
  const audioError = () => { setInlineAudio(null); setPlaying(null); reportOperation('audio', '音频无法播放，请检查项目文件后重试。'); };
  useEffect(() => {
    if (inlineAudio && speech && !speech.audio.some(audio => audio.taskId === inlineAudio.taskId && audio.segmentId === inlineAudio.segmentId)) {
      audioPlayer.current?.pause(); setInlineAudio(null); setPlaying(null);
    }
  }, [inlineAudio, speech]);
  const toggleAudio = (audio: SpeechStatus['audio'][number]) => {
    reportOperation('audio');
    if (inlineAudio?.taskId === audio.taskId && audioPlayer.current) {
      if (audioPlayer.current.paused) void audioPlayer.current.play().catch(audioError);
      else audioPlayer.current.pause();
    } else setInlineAudio(audio);
  };
  const generateSpeech = (segmentId: string, confirmed = false) => {
    if (!confirmed && segmentSpeech(segmentId, speech).latest?.state === 'unknown') { setSpeechRetryId(segmentId); return Promise.resolve(); }
    return navigationView.current!.perform(() => editing.run(async action => {
    if (!status) return;
    reportOperation('speech');
    // 请求标识在提交前保存；断线或刷新后同一按钮复用，避免重复付费。
    const storageKey = `clapgrid-speech:${status.snapshot.project.id}:${segmentId}`;
    const requestId = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, requestId);
    await submitSpeech(panelServiceUrl(), { requestId, segmentId });
    localStorage.removeItem(storageKey);
    const next = await querySpeech(panelServiceUrl());
    action.apply(() => { reportOperation('speech'); setSpeech(next); });
  }, cause => reportOperation('speech', cause.message)));
  };
  const changeVoice = (voice: Voice) => navigationView.current!.perform(() => editing.run(async action => {
    reportOperation('voice');
    await setVoice(panelServiceUrl(), voice);
    const next = await querySpeech(panelServiceUrl());
    action.apply(() => { setSpeech(next); });
  }, cause => reportOperation('voice', cause.message)));
  const navigationView = useRef<ReturnType<typeof useSegmentInteraction> | null>(null);
  const [navigation] = useState(() => segmentNavigation({
    grid: () => grid.current, editing, focus: focusReturns,
    clearSearch: () => flushSync(() => { setQuery(''); setCurrentMatch(null); setSearchOpen(false); }),
    inline: (id, field, intent) => navigationView.current!.begin(field, id, intent), failed,
  }));
  useEffect(() => () => navigation.dispose(), [navigation]);
  const segmentDetail = useSegmentInteraction({ editing, status, accept: setStatus, failed, navigation, focus: focusReturns, grid: () => grid.current,
    canEdit: () => !panelRestore && !!status && !status.taskLocked && !speech?.locked && !exports.exports?.locked,
  });
  navigationView.current = segmentDetail;
  const addSegment = () => segmentDetail.perform(async () => {
    const ticket = navigation.request();
    await editing.save('segments', { acquire: true }, async (token, action) => {
      reportOperation('project');
      const result = await modifyUserBatch(panelServiceUrl(), { changes: [{ kind: 'add', text: '' }] }, token, action.signal);
      const added = result.results[0];
      action.apply(() => { void ticket.arrive(() => { setStatus(result.status); },
        added?.outcome === 'applied' && added.id ? { id: added.id, mode: 'inline', clearSearch: true } : undefined); });
      if (added?.outcome !== 'applied' || !added.id) throw new Error(added?.message ?? '未能确认新增片段，请重新读取项目。');
    }, cause => { ticket.fail(); failed(new Error(`新增失败：${cause.message}`)); });
  });
  const organize = (batch: Batch) => editing.save('segments', { acquire: true }, async (token, action) => {
    reportOperation('project');
    const result = await modifyUserBatch(panelServiceUrl(), batch, token);
    action.apply(() => { setStatus(result.status); setError(''); });
    const unsuccessful = result.results.filter(item => item.outcome !== 'applied');
    if (unsuccessful.length) throw new Error(unsuccessful.map(item => item.message).join('；'));
    action.apply(() => {
      if (batch.changes.some(change => change.kind === 'paste')) setPaste('');
    });
  }, failed);
  const openVideoEditor = (id?: string, index = 0) => segmentDetail.perform(async () => {
    const origin = returnFocus.current.video;
    const requested = focusReturns.intent(origin);
    return editing.begin('segments', next => {
      if (!requested.valid()) {
        focusReturns.acceptGridUpdate(() => setStatus(next));
        void editing.cancel('segments'); return;
      }
      setStatus(next); reportOperation('video');
      if (id) {
        const segment = next.snapshot.segments.find(segment => segment.id === id);
        if (!segment) throw new Error('口播片段已删除');
        const reference = segmentMaterials(segment)[index];
        setSourcePath('');
        setVideoEditor({ segment, index, assetId: '', start: '0' });
      } else { setSourcePath(''); setImporting(true); }
    }, disconnected, cause => {
      reportOperation('video', cause.message);
      if (requested.valid()) focusReturns.close(origin, origin);
    });
  });
  const cancelVideo = () => {
    focusReturns.close(returnFocus.current.video, () => { setVideoEditor(null); setImporting(false); });
    void editing.cancel('segments');
  };
  const saveVideo = () => editing.save('segments', {}, async (token, action) => {
    const origin = returnFocus.current.video;
    reportOperation('video');
    try {
      if (importing) {
        const result = await importMaterial(panelServiceUrl(), sourcePath, token, action.signal);
        action.apply(() => setStatus(result.status));
      } else if (videoEditor) {
        let expected = videoEditor.segment;
        let assetId = videoEditor.assetId;
        if (sourcePath.trim()) {
          const imported = await importMaterial(panelServiceUrl(), sourcePath.trim(), token, action.signal);
          action.apply(() => setStatus(imported.status));
          expected = imported.status.snapshot.segments.find(segment => segment.id === expected.id)!;
          assetId = imported.asset.id;
        }
        if (!assetId) throw new Error('请选择项目素材或填写本地素材路径');
        const assetIds = [...new Set([...segmentMaterials(expected), assetId])];
        const result = await modifyUserBatch(panelServiceUrl(), { changes: [{ kind: 'materials', expected, assetIds }] }, token, action.signal);
        action.apply(() => setStatus(result.status));
        if (result.summary.applied !== 1) throw new Error(result.results[0]?.message ?? '关联未保存');
      }
    } finally { action.apply(() => focusReturns.close(origin, () => { setVideoEditor(null); setImporting(false); })); }
  }, cause => reportOperation('video', cause.message));
  const openAssetRename = (asset: VideoAsset, trigger: HTMLElement) => {
    rememberOrigin(trigger, 'video');
    void segmentDetail.perform(() => editing.begin('segments', next => {
      const current = next.snapshot.assets.find(item => item.id === asset.id);
      if (!current) throw new Error('素材已不存在');
      setStatus(next); setRenameError(''); setAssetRename({ asset: current, name: current.name });
    }, () => setRenameError('编辑连接已断开，请取消后重新打开重命名'), failed));
  };
  const cancelAssetRename = () => {
    if (editing.getState().busy) return;
    focusReturns.close(returnFocus.current.video, () => setAssetRename(null));
    void editing.cancel('segments');
  };
  const saveAssetRename = () => {
    if (!assetRename || !assetRename.name.trim()) return;
    const draft = assetRename;
    setRenameError('');
    void editing.save('segments', { acquire: true }, async (token, action) => {
      const result = await renameMaterial(panelServiceUrl(), { assetId: draft.asset.id, expectedName: draft.asset.name, name: draft.name }, token, action.signal);
      action.apply(() => { setStatus(result.status); focusReturns.close(returnFocus.current.video, () => setAssetRename(null)); });
    }, cause => setRenameError(cause.message));
  };
  const synchronizeSelection = (ids: string[]) => {
    if (restoringPanelSelection.current) return;
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
      if (panelRestoreCancelled.current) synchronizeSelection(grid.current?.getSelectedRows().map(segment => segment.id) ?? []);
      else { grid.current?.deselectAll(); setSelectedIds([]); setSelectionState('勾选已同步'); }
      setPanelReadyVersion(version => version + 1);
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
    if (panelRestoreCancelled.current || !panelRestore || !status || !table.current || !grid.current || error) return;
    const ids = restoredSelection(panelRestore, status.snapshot.project.id, status.instanceId, buildIdentity, status.snapshot.segments.map(segment => segment.id));
    if (ids?.some(id => !grid.current!.getRowNode(id))) return;
    setPanelRestore(null);
    if (ids === null) { setPanelUpdateError('面板更新后的项目或版本已改变，请重新核对并勾选片段。'); return; }
    restoringPanelSelection.current = true;
    try {
      grid.current.deselectAll();
      const nodes = ids.map(id => grid.current!.getRowNode(id)).filter(node => !!node);
      grid.current.setNodesSelected({ nodes, newValue: true });
    } finally { restoringPanelSelection.current = false; }
    synchronizeSelection(ids);
  }, [panelRestore, status, connectionVersion, error, panelReadyVersion, displayOrder.join('\0')]);
  useEffect(() => {
    editing.activate();
    const refresh = () => editing.refresh(
      () => Promise.all([queryStatus(panelServiceUrl()), querySpeech(panelServiceUrl()), queryVisualPreviews(panelServiceUrl())]),
      ([next, nextSpeech, previews]) => { setStatus(next); setSpeech(nextSpeech); setVisualPreviews(previews.tasks); setError(''); },
      cause => { setStatus(previous => navigationView.current?.draft ? previous : undefined); setError(`服务连接失败：${cause.message}。请关闭重开 ClapGrid 并核对当前工作空间。`); },
    );
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    const leave = () => editing.deactivate();
    const resume = () => { editing.activate(); void refresh(); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', resume); editing.deactivate(); };
  }, [editing]);
  useEffect(() => {
    if (!editState.busy && !editState.editing) void editing.refresh(() => Promise.all([queryStatus(panelServiceUrl()), querySpeech(panelServiceUrl())]), ([next, nextSpeech]) => { setStatus(next); setSpeech(nextSpeech); }, () => {});
  }, [editState.busy, editState.editing, editing]);
  const disabled = !status || !speech || speech.locked || status.taskLocked || editState.busy || segmentDetail.finishing || (editState.editing && !segmentDetail.draft) || (!!status.modification && !(editState.owner === 'segments' && editState.editing && segmentDetail.draft)) || !!panelRestore;
  const segmentEditingBusy = segmentDetail.navigating || segmentDetail.finishing || (editState.owner === 'segments' && editState.busy);
  const panelBusy = disabled || segmentDetail.dirty || segmentDetail.saving || editState.editing || mediaBusy || !!playing || !!detail || exportSettingsOpen || !!audioHistory || !!speechRetryId
    || !!videoEditor || !!assetRename || !!trayId || importing || !!preview || !!composedPreview || rowMenuOpen || rowActionMenuOpen || !!deleteTargets || !!reorderPreview || !!panelRestore
    || selectionState !== '勾选已同步';
  const latestPanel = useRef({ busy: panelBusy, selectedIds });
  latestPanel.current = { busy: panelBusy, selectedIds };
  usePanelActivity(table, status?.activePanelIdentity?.state === 'known' && status.activePanelIdentity.schemaVersion === 2, panelBusy);
  const refreshPanel = async () => {
    const connection = table.current;
    if (!connection || latestPanel.current.busy) return;
    try {
      const next = await queryStatus(panelServiceUrl());
      const target = next.activePanelIdentity;
      if (latestPanel.current.busy || table.current !== connection || next.instanceId !== status?.instanceId || next.taskLocked || next.modification
        || !panelNeedsRefresh(buildIdentity, target) || target?.state !== 'known' || !target.panelFingerprint) return;
      if (!writePanelRestore(sessionStorage, panelRestoreKey(panelServiceUrl()), { projectId: next.snapshot.project.id, instanceId: next.instanceId,
        panelFingerprint: target.panelFingerprint, selectedIds: latestPanel.current.selectedIds, createdAt: Date.now() })) throw new Error('无法保存本次勾选，已保留当前面板。');
      window.location.reload();
    } catch (cause) { setPanelUpdateError(cause instanceof Error ? cause.message : '刷新未确认，请稍后重试。'); }
  };
  const drag = useSegmentDrag({ segments: status?.snapshot.segments ?? [], disabled, grid, element: gridElement,
    submit: (expectedIds, ids) => {
      if (!status || editing.getState().busy) return;
      // 松手立即反馈位置；预览不覆盖服务快照，失败或取消后恢复已确认顺序。
      const segments = new Map(status.snapshot.segments.map(segment => [segment.id, segment]));
      setReorderPreview(ids.map((id, index) => ({ ...segments.get(id)!, order: index + 1 })));
      reportOperation('project');
      void segmentDetail.perform(() => organize({ changes: [{ kind: 'reorder', expectedIds, ids }] })).finally(() => setReorderPreview(null));
    },
    reject: message => failed(new Error(message)),
  });
  const requestDelete = () => {
    const targets = rowMenu?.targets ?? [];
    if (!targets.length || disabled || !rowMenu) return;
    menuRestore.current = false; setDeleteTargets({ targets: structuredClone(targets), origin: rowMenu.origin }); setRowMenuOpen(false);
  };
  const insertRelative = async (placement: 'before' | 'after') => {
    if (!rowMenu || rowMenu.targets.length !== 1 || disabled || editing.getState().busy) return;
    const menu = rowMenu;
    const relative = { anchor: menu.anchor, expectedIds: menu.expectedIds, placement };
    menuRestore.current = false; setRowMenuOpen(false);
    await segmentDetail.perform(async savedTarget => {
      const ticket = navigation.request(menu.origin);
      await editing.save('segments', { acquire: true }, async (token, action) => {
        reportOperation('project');
        const compatible = savedTarget(relative.anchor);
        const result = await modifyUserBatch(panelServiceUrl(), { changes: [{ kind: 'add', text: '', relative: { ...relative, anchor: compatible } }] }, token, action.signal);
        const item = result.results[0];
        action.apply(() => { void ticket.arrive(() => setStatus(result.status),
          item?.outcome === 'applied' && item.id ? { id: item.id, mode: 'inline' } : undefined); });
        if (item?.outcome !== 'applied' || !item.id) throw new Error(item?.message ?? '未能确认新增口播片段');
        }, cause => { ticket.fail(); failed(cause); });
    });
  };

  const speechTask = speech?.tasks.at(-1);
  const speechProblems = speech?.tasks.filter(task => task.state === 'failed' || task.state === 'unknown') ?? [];
  const batchTask = speech?.operations.at(-1);
  const exportTask = exports.exports?.tasks.at(-1);
  const exportProblems = exports.exports?.tasks.filter(task => task.state === 'failed' || task.state === 'interrupted') ?? [];
  const lock = speech?.locked ? '配音进行中，项目已锁定；可查询和试听' : exports.exports?.locked ? '导出进行中，项目已锁定' : status?.taskLocked ? '制作任务进行中，项目已锁定' : status?.modification?.owner === 'codex' ? 'Codex 正在修改' : status?.modification?.owner === 'user' ? '用户正在编辑' : '';
  const orderWidth = Math.max(36, 20 + String(status?.snapshot.segments.length ?? 0).length * 8);
  const actionReason = disabled ? lock || (!status || !speech ? '正在连接项目' : '请先结束编辑或等待项目解除占用') : '';
  const actionsFor = (segment: Segment) => segmentActions({ segment, segments: status?.snapshot.segments ?? [], checkedIds: selectedIds, speech, reason: actionReason, draftText: segmentDetail.draft?.id === segment.id ? segmentDetail.draft.text : undefined });
  const checkedAction = status?.snapshot.segments[0] ? actionsFor(status.snapshot.segments[0]).deleteChecked : undefined;
  const stopAudio = () => { audioPlayer.current?.pause(); setPlaying(null); setInlineAudio(null); };
  const visualControls = {
    assets: status?.snapshot.assets ?? [], expandedId: expandedNote, toggleNote,
    trayId, toggleTray: (id: string) => setTrayId(current => current === id ? null : id), previews: visualPreviews,
    composed: (task: ExportTask, trigger: HTMLButtonElement) => { rememberOrigin(trigger, 'preview'); setComposedPreview(task); },
    preview: (assetId: string, trigger: HTMLButtonElement) => { rememberOrigin(trigger, 'preview'); setPreview(assetId); },
    rename: openAssetRename,
    associate: (id: string, trigger: HTMLElement, index = 0) => { rememberOrigin(trigger, 'video'); void openVideoEditor(id, index); },
    unlink: (segment: Segment, index = 0) => { void segmentDetail.perform(savedTarget => { const expected = savedTarget(segment); const assetIds = segmentMaterials(expected).filter((_, i) => i !== index); return organize({ changes: [{ kind: 'materials', expected, assetIds }] }); }); },
  };
  const rowControls = { draft: segmentDetail.draft, speech, disabled, segmentEditingBusy, cancelEdit: segmentDetail.escape, actionsFor, playing, listening: inlineAudio?.taskId ?? null, player: audioPlayer, stop: stopAudio,
    generate: (id: string) => { void generateSpeech(id); }, listen: toggleAudio,
    history: (id: string, trigger: HTMLElement) => { rememberOrigin(trigger, 'history'); setAudioHistory(id); }, onError: audioError };
  const openRowMenu = (segment: Segment, trigger: HTMLElement) => {
    menuRestore.current = true;
    const targets = segmentTargets(status?.snapshot.segments ?? [], selectedIds, segment.id);
    rowMenu?.origin.cancel();
    setRowMenu({ anchor: structuredClone(segment), targets: structuredClone(targets), expectedIds: status?.snapshot.segments.map(item => item.id) ?? [], origin: focusReturns.capture(trigger, { fallback: 'menu' }) });
  };
  const columns: ColDef<Segment>[] = [
    { headerName: '序号', field: 'order', width: orderWidth, minWidth: orderWidth, maxWidth: orderWidth, cellClass: 'px-1!', headerClass: 'px-1!', suppressKeyboardEvent: cellControlKeyboard, cellRenderer: SegmentOrderCell, cellRendererParams: { suppressMouseEventHandling: cellControlMouse, actionsFor, drag, segmentEditingBusy } },
    { headerName: '口播片段', field: 'text', flex: 1, minWidth: 360, resizable: false, editable: false,
      cellRenderer: SegmentRowCell, cellStyle: params => ({ height: mainRowHeight(params.data?.id), paddingRight: 0 }),
      cellRendererParams: { ...rowControls, ...visualControls, query: searchOpen ? query : '', activeId: activeMatch, visit, rowHeight: Math.max(102, searchRowHeight), toggleNote, expandedId: expandedNote, assets: status?.snapshot.assets ?? [],
        editorFor: (data: Segment) => segmentDetail.draft?.id === data.id && segmentDetail.draft.field === 'text' ? <TextEditor key={data.id} value={segmentDetail.draft.text} field="text" data={data} busy={editState.busy || segmentDetail.finishing}
          change={value => navigationView.current?.change(value)} commit={() => { void navigationView.current?.save(); }} cancel={() => navigationView.current?.escape()} /> : null,
        suppressMouseEventHandling: cellControlMouse },
      suppressKeyboardEvent: params => {
        if ((params.event.target as HTMLElement).closest('textarea, input')) return true;
        if ((params.event.target as HTMLElement).closest('button')) return cellControlKeyboard(params);
        if (params.editing) return true;
        return !params.editing && (['Enter', 'F2', 'Backspace', 'Delete'].includes(params.event.key) || params.event.key.length === 1);
      } },
    { headerName: '', colId: 'noteToggle', pinned: 'right', lockPinned: true, width: 48, minWidth: 48, maxWidth: 48, resizable: false,
      suppressKeyboardEvent: cellControlKeyboard, cellStyle: params => ({ height: mainRowHeight(params.data?.id), paddingLeft: 0, paddingRight: 0 }),
      cellRenderer: SegmentRowActions,
      cellRendererParams: { ...rowControls, suppressMouseEventHandling: cellControlMouse, expandedId: expandedNote, toggleNote,
        open: openRowMenu, remove: requestDelete, insert: (placement: 'before' | 'after') => { void insertRelative(placement); }, changed: setRowActionMenuOpen, restore: () => menuRestore.current, menuActions: rowMenu ? segmentActions({ segment: rowMenu.anchor, segments: rowMenu.targets, checkedIds: rowMenu.targets.map(item => item.id), reason: actionReason }) : undefined } },
  ];
  const searchStatus = !query ? '输入文案查找' : !matchedIds.length ? '无匹配片段' : activeMatch ? `第 ${matchedIds.indexOf(activeMatch) + 1} / ${matchedIds.length} 个匹配片段` : `${matchedIds.length} 个匹配片段，点击下一个定位`;
  return <main style={{ '--project-status-height': `${footerHeight}px` } as import('react').CSSProperties} className="relative mx-auto flex h-dvh min-w-0 max-w-[1600px] flex-col gap-1 px-4 py-3 pb-2 max-[600px]:p-2">
    <header className={`mb-1 flex h-8 min-h-8 flex-none flex-nowrap items-center justify-between max-[600px]:gap-1 ${searchOpen ? 'gap-1' : 'gap-3'}`}>
      <h1 className="m-0 flex-none text-[22px] max-[600px]:text-[18px] leading-normal font-semibold">口播片段</h1>
      {searchOpen && <section id="segment-search" className="search-popover absolute right-4 top-12 z-30 flex min-h-10 w-[560px] max-w-[calc(100%-32px)] items-center gap-1 rounded-lg border border-solid border-input bg-background p-2 shadow-lg" role="dialog" aria-modal="false" aria-label="查找口播片段">
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
        <Button size="sm" className={`max-[600px]:px-2 ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={disabled} onClick={() => { void addSegment(); }}>新增口播片段</Button>
        <Button variant="outline" size="sm" className="search-trigger border-input text-foreground max-[600px]:px-2" ref={tableFallback} aria-expanded={searchOpen} aria-controls="segment-search" onClick={() => { setSearchOpen(true); locate(query, 1, true); }}>查找</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground max-[600px]:px-2" disabled={!status || !!error || exports.busy || !exports.exports || exports.exports.locked} aria-describedby="export-scope" title="全片导出：查找与勾选不改变范围" onClick={() => { void exports.run(); }}>导出全片</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground max-[600px]:px-2" ref={moreButton} aria-haspopup="dialog" aria-expanded={detail === 'more'} onClick={event => openDetail('more', event.currentTarget)}>更多</Button>
      </div>
    </header>
    <p id="export-scope" className="sr-only">全片导出：查找与勾选不改变范围</p>
    {detail === 'more' && <DetailPanel title="更多操作" onClose={closeDetail} restoreFocus={returnFocus.current.detail}>
      <div className="flex flex-col gap-2 mb-1">
        {searchOpen && <>
          <Button variant="outline" size="sm" className={`border-input text-foreground shrink-0 ${segmentEditingBusy ? 'disabled:opacity-100' : ''}`} disabled={disabled} onClick={() => { closeDetail(); void addSegment(); }}>新增口播片段</Button>
          <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!status || !!error || exports.busy || !exports.exports || exports.exports.locked} aria-describedby="export-scope" onClick={() => { closeDetail(); void exports.run(); }}>导出全片</Button>
        </>}
        <p className="m-0 text-[12px] text-muted-foreground">全片导出：查找与勾选不改变范围</p>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled} onClick={() => { rememberOrigin(moreButton.current!, 'video'); closeDetail(); void openVideoEditor(); }}>导入项目素材</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled} onClick={() => setDetail('paste')}>粘贴多行文案</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!speech} onClick={() => setDetail('voice')}>声音设置</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={!status} onClick={() => { rememberOrigin(moreButton.current!, 'settings'); closeDetail(); setExportSettingsOpen(true); }}>导出设置</Button>
        <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" onClick={() => setDetail('tasks')}>任务记录</Button>
      </div>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={closeDetail}>关闭</Button>
    </DetailPanel>}
    {detail === 'voice' && speech && <VoicePanel speech={speech} disabled={disabled} busy={editState.busy}
      error={operationErrors.voice} onChange={voice => { void changeVoice(voice); }}
      onClose={closeDetail} restoreFocus={returnFocus.current.detail} />}
    {detail === 'tasks' && <DetailPanel title="任务记录" onClose={closeDetail} restoreFocus={returnFocus.current.detail}>
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
      <ExportTaskDetails controller={exports} previews={visualPreviews} />
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={closeDetail}>关闭任务记录</Button>
    </DetailPanel>}
    {detail === 'diagnostics' && <DetailPanel title="连接诊断" onClose={closeDetail} restoreFocus={returnFocus.current.detail}>
      <p className="m-0" role="status">{error || (status ? '本地服务已连接' : '正在连接本地服务…')}</p>
      {status && <dl className="m-0 rounded-md border border-solid border-input bg-muted p-3 text-[12px] [&_dt]:font-semibold [&_dd]:m-0 [&_dd]:mb-2 [&_dd:last-child]:mb-0">
        <dt>面板版本</dt><dd>{buildIdentity.state === 'known' ? `${buildIdentity.version} (${buildIdentity.contentFingerprint})` : '未知（开发构建或旧版本）'}</dd>
        <dt>服务版本</dt><dd>{status.buildIdentity?.state === 'known' ? `${status.buildIdentity.version} (${status.buildIdentity.contentFingerprint})` : '未知（开发构建或旧版本）'}</dd>
        <dt>版本核对</dt><dd>{panelCompatibility(buildIdentity, status.buildIdentity, status.activePanelIdentity)}</dd>
        <dt>项目路径</dt><dd>{status.snapshot.project.directory}</dd>
        <dt>服务实例</dt><dd>{status.instanceId}</dd>
        <dt>PID</dt><dd>{status.pid}</dd>
      </dl>}
      <p className="m-0 text-[12px] text-muted-foreground">{selectionState}</p>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0 self-start" onClick={closeDetail}>关闭诊断</Button>
    </DetailPanel>}
    {detail === 'paste' && <PastePanel value={paste} busy={editState.busy} disabled={disabled}
      error={operationErrors.project ?? ''} onChange={setPaste}
      onSubmit={() => { void segmentDetail.perform(() => organize({ changes: [{ kind: 'paste', text: paste }] })); }}
      onClose={closeDetail} restoreFocus={returnFocus.current.detail} />}
    {exportSettingsOpen && status && <ExportSettingsPanel restoreFocus={returnFocus.current.settings} editing={editing} status={status} onStatus={setStatus} onError={message => reportOperation('settings', message)} onClose={() => focusReturns.close(returnFocus.current.settings, () => setExportSettingsOpen(false))} />}
    {inlineAudio && <audio ref={audioPlayer} key={inlineAudio.url} src={inlineAudio.url} autoPlay onPlay={() => setPlaying(inlineAudio.taskId)} onPause={() => setPlaying(null)} onEnded={() => { setPlaying(null); setInlineAudio(null); }} onError={audioError} />}
    <AlertDialog open={!!speechRetryId} onOpenChange={open => { if (!open) setSpeechRetryId(null); }}>
      <AlertDialogContent>
        <AlertDialogTitle>重试配音？</AlertDialogTitle>
        <AlertDialogDescription>上次配音结果未知，可能已计费。请核对任务记录后决定是否重新提交。</AlertDialogDescription>
        <div className="flex justify-end gap-2"><AlertDialogCancel onClick={() => setSpeechRetryId(null)}>取消</AlertDialogCancel><Button disabled={disabled} onClick={() => { const id = speechRetryId; setSpeechRetryId(null); if (id) void generateSpeech(id, true); }}>确认重试</Button></div>
      </AlertDialogContent>
    </AlertDialog>
    {audioHistory && <AudioHistoryPanel segmentId={audioHistory} speech={speech} onClose={() => focusReturns.close(returnFocus.current.history, () => setAudioHistory(null))} restoreFocus={returnFocus.current.history} />}
    {assetRename && <DetailPanel title="重命名素材" label="重命名素材" restoreWithinLayer onClose={cancelAssetRename} restoreFocus={returnFocus.current.video}>
      <label className="flex min-w-0 flex-col gap-1">素材名称<Input autoFocus aria-label="素材名称" maxLength={255} value={assetRename.name} disabled={editState.busy} onChange={event => setAssetRename(current => current && { ...current, name: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveAssetRename(); } }} /></label>
      <p className="m-0 text-xs text-muted-foreground">修改项目中的素材名称，所有引用此素材的片段同步更新。</p>
      {renameError && <p role="alert" className="m-0 text-xs text-destructive">{renameError}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={editState.busy} onClick={cancelAssetRename}>取消</Button><Button disabled={editState.busy || !assetRename.name.trim()} onClick={saveAssetRename}>{editState.busy ? '正在保存…' : '保存名称'}</Button></div>
    </DetailPanel>}
    {(videoEditor || importing) && <DetailPanel title={importing ? '导入项目素材' : '添加画面素材'} label={importing ? '导入项目素材' : '添加画面素材'} restoreWithinLayer className="[&_p]:m-0 [&_button]:self-start" onClose={cancelVideo} restoreFocus={returnFocus.current.video}>
      {videoEditor && <label className="flex min-w-0 flex-col gap-1">从项目素材选取<NativeSelect aria-label="项目素材" value={videoEditor.assetId} disabled={editState.busy} onChange={event => { setVideoEditor({ ...videoEditor, assetId: event.target.value }); setSourcePath(''); }}>
        <option value="">请选择素材</option>
        {status?.snapshot.assets.filter(asset => !segmentMaterials(videoEditor.segment).includes(asset.id)).map(asset => <option key={asset.id} value={asset.id}>{asset.kind === 'image' ? '图片' : '视频'} · {asset.name}</option>)}
      </NativeSelect></label>}
      <label className="flex min-w-0 flex-col gap-1">{videoEditor ? '或从本地添加图片／视频' : '图片／视频文件'}<Input aria-label="本地素材绝对路径" value={sourcePath} disabled={editState.busy} onChange={event => setSourcePath(event.target.value)} placeholder="粘贴本地 PNG、JPEG 或视频完整路径" /></label>
      <p>只复制指定文件，保留项目原件。素材的出现时间和位置由 agent 编排。</p>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={editState.busy || (!sourcePath.trim() && !videoEditor?.assetId)} onClick={() => { void saveVideo(); }}>{editState.busy ? '正在处理…' : importing ? '导入并复制' : '加入本句'}</Button><Button variant="outline" onClick={cancelVideo}>取消</Button></div>
    </DetailPanel>}
    {preview && <DetailPanel title={previewAsset?.kind === 'image' ? '图片原件' : '视频原件'} label={previewAsset?.kind === 'image' ? '图片原件' : '视频原件'} restoreWithinLayer className="max-h-[90dvh] overflow-y-auto" onClose={() => focusReturns.close(returnFocus.current.preview, () => setPreview(null))} restoreFocus={returnFocus.current.preview}>
      {previewAsset?.kind === 'image'
        ? <img className="block max-h-[60dvh] w-full object-contain" onError={() => reportOperation('preview', '图片原件不可读取，请检查项目素材文件')} alt={previewAsset?.name ?? '图片原件'} src={`${panelServiceUrl()}/api/media/${preview}/original`} />
        : <video className="block max-h-[60dvh] w-full shrink-0" key={preview} controls muted autoPlay src={`${panelServiceUrl()}/api/media/${preview}/preview`} onError={() => reportOperation('preview', '原件预览不可用，请检查项目素材文件')} />}
      {previewAsset?.derivation && <MaterialDerivationDetails key={preview} derivation={previewAsset.derivation} assets={status!.snapshot.assets} onOpen={assetId => {
        setPreview(assetId);
        previewClose.current?.focus();
      }} />}
      <Button ref={previewClose} variant="outline" onClick={() => focusReturns.close(returnFocus.current.preview, () => setPreview(null))}>关闭预览</Button>
    </DetailPanel>}
    {composedPreview && <DetailPanel title="片段合成预览" label="片段合成预览" restoreWithinLayer onClose={() => focusReturns.close(returnFocus.current.preview, () => setComposedPreview(null))} restoreFocus={returnFocus.current.preview}>
      {!visualPreviews.find(task => task.id === composedPreview.id)?.current && <p role="status">相关输入已变化，此预览待更新，请让 agent 重新制作。</p>}
      <video className="block max-h-[60dvh] w-full shrink-0" controls autoPlay src={`${panelServiceUrl()}${composedPreview.output?.previewUrl ?? composedPreview.output?.url}`} onError={() => reportOperation('preview', '片段合成预览不可播放，请检查任务结果')} />
      <Button variant="outline" onClick={() => focusReturns.close(returnFocus.current.preview, () => setComposedPreview(null))}>关闭预览</Button>
    </DetailPanel>}
    {deleteTargets && <DeleteConfirm count={deleteTargets.targets.length} disabled={disabled} lock={lock}
      onClose={() => focusReturns.close(deleteTargets.origin, () => setDeleteTargets(null))} restoreFocus={deleteTargets.origin}
      onConfirm={() => {
        if (disabled || editing.getState().busy) return;
        const request = deleteTargets;
        // 结果先落到表格，再关闭并按稳定身份恢复；避免返回即将删除的旧 DOM。
        void segmentDetail.perform(savedTarget => organize({ changes: request.targets.map(expected => ({ kind: 'delete', expected: savedTarget(expected) })) })).finally(() => {
          focusReturns.close(request.origin, () => setDeleteTargets(current => current === request ? null : current));
        });
      }} />}
    <ContextMenu modal={false} open={rowMenuOpen} onOpenChange={open => {
      if (!open && menuRestore.current && rowMenu) focusReturns.close(rowMenu.origin, () => setRowMenuOpen(false));
      else setRowMenuOpen(open);
    }}>
    <ContextMenuTrigger asChild>
    <div className="segment-grid w-full min-w-0 flex-1 min-h-0" ref={gridElement} onKeyDownCapture={rowControlTab} onContextMenuCapture={event => {
      // 编辑器的复制粘贴属于系统菜单：只阻止 Trigger 收到事件，不取消浏览器默认行为。
      if ((event.target as HTMLElement).closest('input:not([type="checkbox"]), textarea, .ag-popup-editor')) {
        event.stopPropagation(); setRowMenuOpen(false);
      }
    }} onContextMenu={event => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[row-id]');
      const node = row?.getAttribute('row-id') ? grid.current?.getRowNode(row.getAttribute('row-id')!) : null;
      if (!node?.data || target.closest('input:not([type="checkbox"]), textarea, .ag-popup-editor')) { event.preventDefault(); setRowMenuOpen(false); return; }
      menuRestore.current = true;
      const targets = segmentTargets(status?.snapshot.segments ?? [], grid.current!.getSelectedRows().map(segment => segment.id), node.data.id);
      rowMenu?.origin.cancel();
      const origin = focusReturns.capture(target, { fallback: 'menu' });
      setRowMenu({ anchor: structuredClone(node.data), targets: structuredClone(targets), expectedIds: status?.snapshot.segments.map(segment => segment.id) ?? [], origin });
    }} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], .ag-popup-editor') || editing.getState().editing) return;
      event.preventDefault();
    }}>{drag.indicator}<AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      animateRows={false}
      readOnlyEdit suppressClickEdit popupParent={document.body}
      selectionColumnDef={{ width: 34, minWidth: 34, maxWidth: 34, cellClass: '[&_.ag-cell-wrapper]:h-full', cellStyle: params => ({ height: mainRowHeight(params.data?.id) }) }}
      rowSelection={{ mode: 'multiRow', selectAll: 'all', enableClickSelection: false, enableSelectionWithoutKeys: false }}
      onSelectionChanged={event => {
        if (panelRestore && ['checkboxSelected', 'rowClicked', 'spaceKey', 'keyboardSelectAll', 'uiSelectAll', 'uiSelectAllFiltered', 'uiSelectAllCurrentPage'].includes(event.source)) {
          panelRestoreCancelled.current = true; setPanelRestore(null);
        }
        synchronizeSelection(event.api.getSelectedRows().map(segment => segment.id));
      }}
      onGridReady={event => { grid.current = event.api; setPanelReadyVersion(version => version + 1); }}
      onModelUpdated={event => {
        const ids: string[] = []; event.api.forEachNodeAfterFilterAndSort(node => { if (node.data) ids.push(node.data.id); });
        setDisplayOrder(previous => previous.join('\0') === ids.join('\0') ? previous : ids);
        if (currentMatch) { const index = event.api.getRowNode(currentMatch)?.rowIndex; if (index != null) searchAnchor.current = index; }
      }}
      getRowHeight={params => mainRowHeight(params.data?.id) + (params.data?.id === searchLayout.current.expandedNote ? searchLayout.current.noteHeight : 0)}
      onCellClicked={event => { if (event.colDef.field === 'text' && event.data && (event.event?.target as HTMLElement)?.closest('[data-segment-script]')) { segmentDetail.navigate({ id: event.data.id, inline: true, field: 'text', preventScroll: true }); } }}
      onCellDoubleClicked={event => { if (event.colDef.field === 'visualNote' && event.data && !(event.event?.target as HTMLElement)?.closest('textarea, button, [data-segment-support], [data-segment-speech]')) { segmentDetail.navigate({ id: event.data.id, inline: true, field: 'visualNote' }); } }}
      onCellKeyDown={event => {
        if ((event.event?.target as HTMLElement)?.closest('button, input, textarea, [data-segment-support]')) return;
        const key = (event.event as KeyboardEvent).key;
        if ('colDef' in event && (event.colDef.field === 'text' || event.colDef.field === 'visualNote') && event.data && !(event.event as KeyboardEvent).isComposing && (['Enter', 'F2'].includes(key))) segmentDetail.navigate({ id: event.data.id, inline: true, field: event.colDef.field as 'text' | 'visualNote' });
      }}
      getRowId={params => params.data.id}

      rowClass="group/segment" suppressRowHoverHighlight theme={theme} loading={!status && !error} columnDefs={columns} rowData={reorderPreview ?? status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true, cellStyle: params => ({ height: mainRowHeight(params.data?.id) }) }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      noRowsOverlayComponent={EmptyProject}
      noRowsOverlayComponentParams={{ message: error ? '暂时无法读取口播片段' : '暂无口播片段' }} /></AgGridProvider>
      <SegmentRowDetails expandedId={expandedNote} mainHeight={mainRowHeight(expandedNote ?? undefined)} onHeight={setNoteHeight} onCollapse={() => setExpandedNote(null)} element={gridElement} segments={reorderPreview ?? status?.snapshot.segments ?? []} onOpen={(id, trigger) => { segmentDetail.navigate({ id, inline: true, field: 'visualNote' }, focusReturns.capture(trigger)); }} editReason={actionReason} segmentEditingBusy={segmentEditingBusy} editor={segmentDetail.draft?.field === 'visualNote' && segmentDetail.draft.id === expandedNote ? <div className="h-32"><TextEditor key={segmentDetail.draft.id} data={status!.snapshot.segments.find(item => item.id === expandedNote)!} field="visualNote" value={segmentDetail.draft.visualNote} busy={editState.busy || segmentDetail.finishing} change={value => segmentDetail.change(value, 'visualNote')} commit={() => { void segmentDetail.save(); }} cancel={segmentDetail.escape} /></div> : undefined} />
    </div>
    </ContextMenuTrigger>
    {rowMenu && <RowMenu onCloseAutoFocus={event => {
      event.preventDefault();
      if (menuRestore.current) rowMenu.origin();
    }} onInteractOutside={() => { if (menuRestore.current) rowMenu.origin.cancel(); menuRestore.current = false; }}>
      {(() => {
        const menu = segmentRowMenu(segmentActions({ segment: rowMenu.anchor, segments: rowMenu.targets, checkedIds: rowMenu.targets.map(item => item.id), reason: actionReason }), rowMenu.anchor.order);
        return <><div className="px-2 py-1 text-xs text-muted-foreground">{menu.scope}</div>
          {menu.items.map(item => <ContextMenuItem key={item.key} aria-label={item.label} aria-description={item.reason || undefined} disabled={!item.enabled} title={item.reason} onSelect={() => { if (item.key === 'delete') requestDelete(); else void insertRelative(item.key); }}>{item.label}{item.reason && <span className="text-xs text-muted-foreground"> · {item.reason}</span>}</ContextMenuItem>)}</>;
      })()}
    </RowMenu>}
    </ContextMenu>
    <div className="flex h-4 shrink-0 items-center justify-center"><Button variant="ghost" size="sm" className={segmentEditingBusy ? 'disabled:opacity-100' : ''} aria-label="新增口播片段（表格底部）" title="新增口播片段" disabled={disabled} onClick={() => { void addSegment(); }}>＋</Button></div>
    {segmentDetail.draft && segmentDetail.deleted && deletedDraftOpen && <DetailPanel title="已删除片段的草稿" onClose={() => focusReturns.close(returnFocus.current.draft, () => setDeletedDraftOpen(false))} restoreFocus={returnFocus.current.draft}><section aria-label="已删除片段的草稿" className="flex min-h-0 max-h-[45dvh] flex-col gap-2 overflow-y-auto rounded-md border border-solid border-input p-3 [&>textarea]:shrink-0 [&>button]:shrink-0">
      <p className="m-0 text-sm">片段已删除，草稿仍可选中复制；无法保存到已删除片段。</p>
      <textarea aria-label="已删除片段的文案草稿" readOnly value={segmentDetail.draft.text} className="min-h-20 rounded-md border border-solid border-input p-2" />
      <textarea aria-label="已删除片段的画面说明草稿" readOnly value={segmentDetail.draft.visualNote} className="min-h-20 rounded-md border border-solid border-input p-2" />
      <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(`${segmentDetail.draft!.text}\n\n${segmentDetail.draft!.visualNote}`).catch(cause => failed(cause)); }}>复制草稿</Button>
      <Button variant="outline" onClick={() => { void segmentDetail.discard(); setDeletedDraftOpen(false); }}>放弃草稿</Button>
    </section></DetailPanel>}
    <SegmentDraftPrompt controller={segmentDetail} busy={editState.busy} />
    <footer ref={statusFooter} className="flex-none border-0 border-t border-solid border-input pt-1 text-[12px] text-muted-foreground [&_p]:m-0 [&_p]:wrap-anywhere" aria-label="项目状态">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-[600px]:gap-1 min-[600px]:flex-nowrap" role="status">
        <span className="w-[108px] flex-none truncate max-[600px]:sr-only" title={lock || undefined}>{error ? '服务连接失败' : lock || (status ? '本地服务已连接' : '正在连接本地服务…')}</span>
        <span className="w-6 flex-none truncate min-[600px]:hidden" aria-hidden="true" title={lock || undefined}>{error ? '离线' : lock ? '占用' : status ? '在线' : '连接'}</span>
        <span className="flex-none" aria-label="勾选范围"><span className="max-[600px]:hidden">已勾选 {selectedIds.length} 条</span><span className="min-[600px]:hidden">已选 {selectedIds.length}</span></span>
        <Button variant="ghost" size="xs" className="h-6 shrink-0 px-1 text-xs" disabled={!selectedIds.length} onClick={() => grid.current?.deselectAll()}>清空勾选</Button>
        <span className="h-6 w-[68px] shrink-0 max-[600px]:w-10">{selectedIds.length > 0 && <Button aria-label="删除已勾选" variant="ghost" size="xs" className={segmentEditingBusy ? 'disabled:opacity-100' : ''} disabled={!checkedAction?.enabled} title={checkedAction?.reason} onClick={event => {
          if (!status) return;
          setDeleteTargets({ targets: structuredClone(status.snapshot.segments.filter(item => checkedAction?.ids.includes(item.id))), origin: focusReturns.capture(event.currentTarget) });
        }}><span className="max-[600px]:hidden">删除已勾选</span><span className="min-[600px]:hidden">删除</span></Button>}</span>
        <span data-save-status className={`min-w-[48px] flex-none ${segmentDetail.draftError || segmentDetail.deleted ? 'text-destructive' : ''}`}>{status || segmentDetail.draft ? segmentDetail.draftStatus : '等待读取项目'}</span>
        <span className="h-6 w-[68px] shrink-0 max-[600px]:w-10">{(segmentDetail.dirty || segmentDetail.draftError || segmentDetail.deleted) && <Button aria-label="回到草稿" variant="ghost" size="xs" onClick={event => { if (segmentDetail.deleted) { rememberOrigin(event.currentTarget, 'draft'); setDeletedDraftOpen(true); } else { if (segmentDetail.draft?.field === 'visualNote') setExpandedNote(segmentDetail.draft.id); segmentDetail.returnToDraft(); } }}><span className="max-[600px]:hidden">回到草稿</span><span className="min-[600px]:hidden">草稿</span></Button>}</span>
        <span className="min-w-0 flex-1 truncate">{batchTask && batchTask.summary.pending > 0 ? `配音 ${batchTask.summary.completed}/${batchTask.summary.completed + batchTask.summary.pending}` : speechTask && (speechTask.state === 'running' || speechTask.state === 'accepted') ? '配音生成中' : exportTask && exports.exports?.locked ? `${exportStateLabel[exportTask.state]} ${exportTask.completed}/${exportTask.total}` : ''}</span>
        <Button variant="outline" size="xs" className="border-input text-foreground px-1.5 py-0.5 text-[12px]" onClick={event => openDetail('tasks', event.currentTarget)}>任务详情</Button>
      </div>
      {panelNeedsRefresh(buildIdentity, status?.activePanelIdentity) && <p className="flex items-center gap-2 pt-1" role="status">
        <span>{panelBusy ? '新版面板已准备，当前编辑或播放结束后可刷新。' : '新版面板已准备。'}</span>
        <Button variant="outline" size="xs" disabled={panelBusy} onClick={() => { void refreshPanel(); }}>刷新面板</Button>
      </p>}
      {panelUpdateError && <p role="alert">{panelUpdateError}</p>}
      {(error || segmentDetail.draftError || Object.values(operationErrors).some(Boolean) || exports.connectionError || exports.operationError || speechProblems.length > 0 || exportProblems.length > 0 || selectionState.includes('断开')) && <div className="max-h-[22dvh] overflow-auto bg-[var(--color-error-surface)] text-destructive" aria-label="操作异常">
        {error && <p role="alert">{error}</p>}
        {segmentDetail.draftError && <p role="alert">{segmentDetail.draftError}</p>}
        {Object.entries(operationErrors).filter(([, message]) => message).map(([kind, message]) => <p key={kind} role="alert">{message}</p>)}
        {exports.connectionError && <p role="alert">{exports.connectionError}</p>}
        {exports.operationError && <p role="alert">{exports.operationError}</p>}
        {speechProblems.length > 0 && <p role="alert">配音异常 {speechProblems.length} 项{speechProblems.some(task => task.state === 'unknown') ? ' · 结果未知，可能已计费' : ' · 生成失败'}，请查看任务详情</p>}
        {exportProblems.length > 0 && <p role="alert">导出失败或中断 {exportProblems.length} 项，请查看任务详情</p>}
        {selectionState.includes('断开') && <p role="alert">{selectionState} <Button variant="outline" size="xs" className="border-input text-foreground px-1.5 py-0.5 text-[12px]" onClick={() => setConnectionVersion(version => version + 1)}>重新连接勾选</Button></p>}
      </div>}
    </footer>
  </main>;
}
