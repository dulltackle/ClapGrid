import { Dialog } from './dialog.js';
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
import { TextEditor } from './text-editor.js';
import './style.css';

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
  fontSize: 14,
  spacing: 4,
  borderRadius: 'var(--radius-control)',
  wrapperBorderRadius: 'var(--radius-panel)',
  headerHeight: 40,
  rowHeight: 80,
});

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

function EmptyProject({ message }: { message: string }) { return <span>{message}</span>; }

export function App() {
  const [editing] = useState(() => projectEditing(() => beginEdit(window.location.origin)));
  const editState = useSyncExternalStore(editing.subscribe, editing.getState);
  const [detail, setDetail] = useState<'more' | 'voice' | 'paste' | 'tasks' | 'diagnostics' | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const exports = useExportTasks(() => { void editing.refresh(() => queryStatus(window.location.origin), setStatus, () => {}); });
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>();
  const [speech, setSpeech] = useState<SpeechStatus>();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioHistory, setAudioHistory] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [videoEditor, setVideoEditor] = useState<{ segment: Segment; assetId: string; start: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [preview, setPreview] = useState<{ assetId: string; start: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionState, setSelectionState] = useState('正在连接勾选…');
  const [connectionVersion, setConnectionVersion] = useState(0);
  const table = useRef<TableSession | null>(null);
  const selectionVersion = useRef(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [saveError, setSaveError] = useState('');
  const grid = useRef<GridApi<Segment> | null>(null);
  const tableFallback = useRef<HTMLInputElement>(null);
  const returnFocus = useRef({ settings: () => {}, history: () => {}, audio: () => {}, video: () => {}, preview: () => {}, detail: () => {} });
  const rememberOrigin = (trigger: HTMLElement, detail: keyof typeof returnFocus.current) => {
    returnFocus.current[detail] = dialogReturnFocus(trigger, () => grid.current, () => tableFallback.current);
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
      queueMicrotask(() => { void editing.refresh(() => queryStatus(window.location.origin), setStatus, () => {}); });
    } else failed(cause);
  });
  const columns: ColDef<Segment>[] = [
    { headerName: '序号', field: 'order', width: 80, sortable: true },
    { headerName: '文案', field: 'text', sortable: true, flex: 1, minWidth: 200, editable: () => editing.getState().owner === 'segments' && editing.getState().editing && saveState !== 'saving' && !error,
      cellClass: 'text-cell', cellRenderer: (params: { value?: string }) => <span className="text-summary">{params.value}</span>,
      cellEditor: TextEditor, cellEditorPopup: true,
      suppressKeyboardEvent: params => {
        if (params.editing && params.event.key === 'Tab') { params.api.stopEditing(); return true; }
        return !params.editing && (['Enter', 'F2', 'Backspace', 'Delete'].includes(params.event.key) || params.event.key.length === 1);
      } },
    { headerName: '画面素材', width: 310, suppressKeyboardEvent: cellControlKeyboard, cellRenderer: (params: { data?: Segment }) => {
      const segment = params.data;
      if (!segment) return null;
      const asset = status?.snapshot.assets.find(asset => asset.id === segment.video?.assetId);
      return <div className="video-cell">
        {asset && <button className="thumbnail" aria-label={`播放 ${asset.name}`} onClick={event => { rememberOrigin(event.currentTarget, 'preview'); setPreview(segment.video); }}>
          <img src={`/api/media/${asset.id}/thumbnail`} alt={asset.name} />
        </button>}
        <span>{asset ? `${asset.name} · ${segment.video!.start} 秒` : '未关联视频'}</span>
        <button disabled={disabled} onClick={event => { rememberOrigin(event.currentTarget, 'video'); void openVideoEditor(segment.id); }}>{asset ? '更改' : '关联'}</button>
      </div>;
    } },
    { headerName: '配音', width: 460, suppressKeyboardEvent: cellControlKeyboard, cellRendererParams: { suppressMouseEventHandling: () => true }, cellRenderer: (params: { data?: Segment }) => {
      const segment = params.data; if (!segment) return null;
      const tasks = speech?.tasks.filter(task => task.segmentId === segment.id) ?? [];
      const latest = tasks.at(-1);
      const taskLabel = latest ? { accepted: '已受理', running: '生成中', succeeded: '生成成功', failed: '生成失败', unknown: '结果未知，可能已计费' }[latest.state] : '未生成';
      const recordings = speech?.audio.filter(audio => audio.segmentId === segment.id) ?? [];
      const audio = recordings.filter(audio => audio.valid).at(-1) ?? recordings.at(-1);
      return <div className="speech-cell">
        <div className="speech-state">
          <span>{audio ? audio.valid ? '有效配音' : '配音待更新' : '配音缺失'}</span>
          <span title={latest?.message}>最近任务：{taskLabel}</span>
        </div>
        <button disabled={disabled || !segment.text.trim()} onClick={() => { void generateSpeech(segment.id); }}>{latest?.state === 'failed' || latest?.state === 'unknown' ? '重试配音' : latest ? '重新生成' : '生成配音'}</button>
        {audio && <button onClick={event => { rememberOrigin(event.currentTarget, 'audio'); setAudioUrl(audio.url); }}>试听{audio.valid ? '' : '（待更新）'}</button>}
        {recordings.length > 0 && <button aria-label={`展开片段 ${segment.order} 的保留音频`} onClick={event => { rememberOrigin(event.currentTarget, 'history'); setAudioHistory(segment.id); }}>音频 {recordings.length}</button>}
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
    await submitSpeech(window.location.origin, { requestId, segmentId });
    localStorage.removeItem(storageKey);
    const next = await querySpeech(window.location.origin);
    action.apply(() => { setSaveError(''); setSaveState('saved'); setSpeech(next); });
  }, failed);
  const changeVoice = (voice: Voice) => editing.run(async action => {
    setSaveError('');
    await setVoice(window.location.origin, voice);
    const next = await querySpeech(window.location.origin);
    action.apply(() => { setSpeech(next); setSaveState('saved'); });
  }, failed);
  const save = (change: { id?: string; text: string }) => editing.save('segments', { acquire: !change.id }, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    const next = await saveSegment(window.location.origin, change, token);
    action.apply(() => { setStatus(next); setError(''); setSaveState('saved'); });
  }, cause => failed(new Error(`保存失败：${cause.message}`)));
  const organize = (batch: Batch) => editing.save('segments', { acquire: true }, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    const result = await modifyUserBatch(window.location.origin, batch, token);
    action.apply(() => { setStatus(result.status); setError(''); });
    const unsuccessful = result.results.filter(item => item.outcome !== 'applied');
    if (unsuccessful.length) throw new Error(unsuccessful.map(item => item.message).join('；'));
    action.apply(() => {
      setSaveState('saved');
      if (batch.changes.some(change => change.kind === 'paste')) setPaste('');
    });
  }, failed);
  const openVideoEditor = (id?: string) => editing.begin('segments', next => {
    setStatus(next); setSaveError(''); setSaveState('saved');
    if (id) {
      const segment = next.snapshot.segments.find(segment => segment.id === id);
      if (!segment) throw new Error('口播片段已删除');
      setVideoEditor({ segment, assetId: segment.video?.assetId ?? '', start: String(segment.video?.start ?? 0) });
    } else { setSourcePath(''); setImporting(true); }
  }, disconnected, cause => { failed(cause); requestAnimationFrame(returnFocus.current.video); });
  const cancelVideo = () => {
    setVideoEditor(null); setImporting(false); setSaveState('saved');
    void editing.cancel('segments');
  };
  const saveVideo = () => editing.save('segments', {}, async (token, action) => {
    setSaveState('saving'); setSaveError('');
    try {
      if (importing) {
        const result = await importVideo(window.location.origin, sourcePath, token, action.signal);
        action.apply(() => setStatus(result.status));
      } else if (videoEditor) {
        if (!videoEditor.start.trim()) throw new Error('请填写视频起点');
        const result = await modifyUserBatch(window.location.origin, { changes: [{ kind: 'video', expected: videoEditor.segment,
          assetId: videoEditor.assetId || null, start: Number(videoEditor.start) }] }, token, action.signal);
        action.apply(() => setStatus(result.status));
        if (result.summary.applied !== 1) throw new Error(result.results[0]?.message ?? '关联未保存');
      }
      action.apply(() => setSaveState('saved'));
    } finally { action.apply(() => { setVideoEditor(null); setImporting(false); }); }
  }, failed);
  const move = (direction: -1 | 1) => {
    const ids = status?.snapshot.segments.map(segment => segment.id) ?? [];
    const position = ids.indexOf(selectedIds[0]!);
    const destination = position + direction;
    if (selectedIds.length !== 1 || position < 0 || destination < 0 || destination >= ids.length) return;
    const next = [...ids];
    [next[position], next[destination]] = [next[destination]!, next[position]!];
    void organize({ changes: [{ kind: 'reorder', expectedIds: ids, ids: next }] });
  };
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
    void connectTable(window.location.origin).then(next => {
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
      () => Promise.all([queryStatus(window.location.origin), querySpeech(window.location.origin)]),
      ([next, nextSpeech]) => { setStatus(next); setSpeech(nextSpeech); setError(''); },
      () => { setStatus(undefined); setError('服务连接失败，请通过 Codex 检查本地服务。'); },
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
  const selectedPosition = status?.snapshot.segments.findIndex(segment => segment.id === selectedIds[0]) ?? -1;
  const speechTask = speech?.tasks.at(-1);
  const speechProblems = speech?.tasks.filter(task => task.state === 'failed' || task.state === 'unknown') ?? [];
  const batchTask = speech?.operations.at(-1);
  const exportTask = exports.exports?.tasks.at(-1);
  const exportProblems = exports.exports?.tasks.filter(task => task.state === 'failed' || task.state === 'interrupted') ?? [];
  const lock = speech?.locked ? '配音进行中，项目已锁定；可查询和试听' : status?.taskLocked || exports.exports?.locked ? '导出进行中，项目已锁定' : status?.modification?.owner === 'codex' ? 'Codex 正在修改' : status?.modification?.owner === 'user' ? '用户正在编辑' : '';
  return <main>
    <header><h1>口播片段</h1>
      <div className="toolbar">
        <button disabled={disabled} onClick={() => { void save({ text: '' }); }}>新增口播片段</button>
        <button disabled={exports.busy || !exports.exports || exports.exports.locked} aria-describedby="export-scope" onClick={() => { void exports.run(); }}>导出全片</button>
        <button ref={moreButton} aria-haspopup="dialog" onClick={event => openDetail('more', event.currentTarget)}>更多</button>
      </div>
    </header>
    <p id="export-scope" className="export-scope">全片导出：筛选与勾选不改变范围</p>
    {detail === 'more' && <Dialog label="更多操作" onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail}>
      <h2>更多操作</h2>
      <div className="more-actions">
        <button disabled={disabled} onClick={() => { rememberOrigin(moreButton.current!, 'video'); setDetail(null); void openVideoEditor(); }}>导入本地视频</button>
        <button disabled={disabled} onClick={() => setDetail('paste')}>粘贴多行文案</button>
        <button disabled={!speech} onClick={() => setDetail('voice')}>声音设置</button>
        <button disabled={!status} onClick={() => { rememberOrigin(moreButton.current!, 'settings'); setDetail(null); setExportSettingsOpen(true); }}>导出设置</button>
        <button onClick={() => setDetail('tasks')}>任务记录</button>
      </div>
      <button onClick={() => setDetail(null)}>关闭</button>
    </Dialog>}
    {detail === 'voice' && speech && <Dialog label="统一声音设置" onClose={() => { if (!editState.busy) setDetail(null); }} restoreFocus={returnFocus.current.detail}>
      <h2>统一声音设置</h2>
      <div className="toolbar">
        <label>统一音色 <select aria-label="统一音色" disabled={disabled} value={speech.voice.speaker} onChange={event => { void changeVoice({ ...speech.voice, speaker: event.target.value as Voice['speaker'] }); }}>
          <option value="zh_female_vv_uranus_bigtts">vivi 2.0</option>
          <option value="zh_female_santongyongns_saturn_bigtts">流畅女声</option>
          <option value="zh_male_ruyayichen_saturn_bigtts">儒雅逸辰</option>
        </select></label>
        <label>统一语速 {(1 + speech.voice.speechRate / 100).toFixed(2)} 倍
          <select aria-label="统一语速" disabled={disabled} value={speech.voice.speechRate} onChange={event => { void changeVoice({ ...speech.voice, speechRate: Number(event.target.value) }); }}>
            {Array.from({ length: 151 }, (_, index) => index - 50).map(rate => <option key={rate} value={rate}>{(1 + rate / 100).toFixed(2)} 倍</option>)}
          </select>
        </label>
        <span>TokenDance 凭据：{speech.configured ? '已配置' : '未配置'}</span>
      </div>
      <p>文案通过 TokenDance seed-tts-2.0 生成配音，可能产生费用。配置位置：{speech.configPath}，键名 TOKENDANCE_KEY。已配置不代表服务已验证。</p>
      {saveState === 'failed' && <p role="alert">{saveError}</p>}
      <button disabled={editState.busy} onClick={() => setDetail(null)}>关闭声音设置</button>
    </Dialog>}
    {detail === 'tasks' && <Dialog label="任务记录" onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail}>
      <h2>任务记录</h2>
      {speech && <section aria-label="配音任务">
      {speech.operations.length > 0 && <section aria-label="批量配音进度" aria-live="polite">
        {speech.operations.slice().reverse().map(operation => <details key={operation.id} open={operation.summary.pending > 0}>
          <summary>批量配音：完成 {operation.summary.completed} · 成功 {operation.summary.succeeded} · 失败 {operation.summary.failed} · 已中断 {operation.summary.interrupted} · 待完成 {operation.summary.pending} · 跳过 {operation.summary.skipped} · 拒绝 {operation.summary.rejected}</summary>
          <p>操作 {operation.id} · 请求 {operation.request.requestId}</p>
          {operation.results.map(item => <p key={item.segmentId}>片段 {status?.snapshot.segments.find(segment => segment.id === item.segmentId)?.order ?? item.segmentId}：{({ accepted: '已受理', existing: '已有任务', skipped: '已跳过', rejected: '被拒绝' })[item.outcome]} · {item.state ? ({ accepted: '尚未完成', running: '正在生成', succeeded: '成功', failed: '失败', unknown: '已中断／结果未知' })[item.state] : ''} · {item.message}</p>)}
        </details>)}
      </section>}
      {speech.tasks.length > 0 && <details open><summary>配音任务与请求标识</summary>{speech.tasks.map(task => <p key={task.id}>任务 {task.id} · 请求 {task.requestId}：{task.message}</p>)}</details>}
        {!speech.tasks.length && <p>暂无配音任务</p>}
      </section>}
      <ExportTaskDetails controller={exports} />
      <button onClick={() => setDetail(null)}>关闭任务记录</button>
    </Dialog>}
    {detail === 'diagnostics' && <Dialog label="连接诊断" onClose={() => setDetail(null)} restoreFocus={returnFocus.current.detail}>
      <h2>连接诊断</h2><p>{error || (status ? '本地服务已连接' : '正在连接本地服务…')}</p>
      {status && <dl className="diagnostics">
        <dt>项目路径</dt><dd>{status.snapshot.project.directory}</dd>
        <dt>服务实例</dt><dd>{status.instanceId}</dd>
        <dt>PID</dt><dd>{status.pid}</dd>
      </dl>}
      <p>{selectionState}</p>
      <button onClick={() => setDetail(null)}>关闭诊断</button>
    </Dialog>}
    {detail === 'paste' && <Dialog label="粘贴多行文案" onClose={() => { if (!editState.busy) setDetail(null); }} restoreFocus={returnFocus.current.detail}>
      <h2>粘贴多行文案</h2>
      {saveState === 'failed' && <p role="alert">{saveError}</p>}
      <textarea aria-label="多行文案" value={paste} disabled={editState.busy} onChange={event => setPaste(event.target.value)} placeholder="每个非空行创建一个口播片段" />
      <div className="toolbar">
        <button disabled={disabled || !paste.trim()} onClick={() => { void organize({ changes: [{ kind: 'paste', text: paste }] }); }}>按非空行新增</button>
        <button disabled={editState.busy} onClick={() => setDetail(null)}>关闭</button>
      </div>
    </Dialog>}
    {exportSettingsOpen && status && <ExportSettingsPanel restoreFocus={returnFocus.current.settings} editing={editing} status={status} onStatus={setStatus} onSaveState={(state, message = '') => { setSaveState(state); setSaveError(message); }} onClose={() => setExportSettingsOpen(false)} />}
    {audioHistory && <Dialog label="保留音频" onClose={() => setAudioHistory(null)} restoreFocus={returnFocus.current.history}>
      <h2>保留音频</h2>
      <ul className="audio-history">{speech?.audio.filter(audio => audio.segmentId === audioHistory).slice().reverse().map(audio => <li key={audio.taskId}>
        <p><time dateTime={audio.createdAt}>{new Date(audio.createdAt).toLocaleString()}</time> · {audio.valid ? '有效配音' : '配音待更新'}</p>
        <p className="audio-text">{audio.input.text}</p>
        <audio controls preload="none" src={audio.url} aria-label={`试听 ${audio.input.text}`} />
      </li>)}</ul>
      <button onClick={() => setAudioHistory(null)}>关闭</button>
    </Dialog>}
    {audioUrl && <Dialog label="配音试听" onClose={() => setAudioUrl(null)} restoreFocus={returnFocus.current.audio}>
      <h2>配音试听</h2><audio controls autoPlay src={audioUrl} onError={() => { setSaveState('failed'); setSaveError('音频不可读取，请检查项目文件'); }} />
      <button onClick={() => setAudioUrl(null)}>关闭试听</button>
    </Dialog>}
    <section className="organization" aria-label="组织口播片段">
      <div className="toolbar">
        <label>筛选文案 <input ref={tableFallback} aria-label="筛选文案" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        {selectedIds.length > 0 && <>
          <span>已勾选 {selectedIds.length} 个片段（含筛选隐藏项）</span>
          <button disabled={disabled || !selectedIds.length} onClick={() => {
            const targets = status!.snapshot.segments.filter(segment => selectedIds.includes(segment.id));
            void organize({ changes: targets.map(expected => ({ kind: 'delete', expected })) });
          }}>删除勾选</button>
          <button disabled={disabled || selectedIds.length !== 1 || selectedPosition <= 0} onClick={() => move(-1)}>项目顺序上移</button>
          <button disabled={disabled || selectedIds.length !== 1 || selectedPosition < 0 || selectedPosition >= (status?.snapshot.segments.length ?? 0) - 1} onClick={() => move(1)}>项目顺序下移</button>
        </>}
      </div>
    </section>
    {(videoEditor || importing) && <Dialog label={importing ? '导入本地视频' : '关联视频'} onClose={cancelVideo} restoreFocus={returnFocus.current.video}>
      <h2>{importing ? '导入本地视频' : '关联视频'}</h2>
      {importing ? <label>视频文件绝对路径<input aria-label="视频文件绝对路径" value={sourcePath} disabled={saveState === 'saving'} onChange={event => setSourcePath(event.target.value)} placeholder="粘贴要导入的本地视频完整路径" /></label>
        : videoEditor && <>
          <label>素材<select aria-label="关联素材" value={videoEditor.assetId} disabled={saveState === 'saving'} onChange={event => setVideoEditor({ ...videoEditor, assetId: event.target.value, start: '0' })}>
            <option value="">解除关联</option>
            {status?.snapshot.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}（{asset.duration.toFixed(2)} 秒）</option>)}
          </select></label>
          <label>播放起点（秒）<input aria-label="播放起点（秒）" type="number" min="0" step="any" disabled={!videoEditor.assetId || saveState === 'saving'} value={videoEditor.start} onChange={event => setVideoEditor({ ...videoEditor, start: event.target.value })} /></label>
          {!status?.snapshot.assets.length && <p>请先取消并导入本地视频。</p>}
        </>}
      {importing && <p>只读取指定文件，复制到项目并生成静音预览。原文件之后可移动或改名。</p>}
      <div className="toolbar"><button disabled={saveState === 'saving' || (importing && !sourcePath.trim())} onClick={() => { void saveVideo(); }}>{saveState === 'saving' ? '正在处理…' : importing ? '导入并复制' : '保存关联与起点'}</button>
        <button onClick={() => { void cancelVideo(); }}>取消</button></div>
    </Dialog>}
    {preview && <Dialog label="视频预览" onClose={() => setPreview(null)} restoreFocus={returnFocus.current.preview}>
      <h2>视频预览</h2><video key={preview.assetId} controls muted autoPlay src={`/api/media/${preview.assetId}/preview`} onLoadedMetadata={event => { event.currentTarget.currentTime = preview.start; }} onError={() => { setSaveError('预览不可用，请检查项目素材文件'); setSaveState('failed'); }} />
      <p>从 {preview.start} 秒开始，预览默认静音。</p><button onClick={() => setPreview(null)}>关闭预览</button>
    </Dialog>}
    <div className="grid"><AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      readOnlyEdit stopEditingWhenCellsLoseFocus suppressClickEdit popupParent={document.body}
      rowSelection={{ mode: 'multiRow', selectAll: 'filtered', enableClickSelection: false }}
      quickFilterText={filter}
      onSelectionChanged={event => synchronizeSelection(event.api.getSelectedRows().map(segment => segment.id))}
      onGridReady={event => { grid.current = event.api; }}
      onCellDoubleClicked={event => { if (event.colDef.field === 'text' && event.data) void startEdit(event.data.id); }}
      onCellKeyDown={event => {
        const key = (event.event as KeyboardEvent).key;
        if ('colDef' in event && event.colDef.field === 'text' && event.data && !editing.getState().editing && (['Enter', 'F2'].includes(key) || key.length === 1)) void startEdit(event.data.id);
      }}
      getRowId={params => params.data.id}
      onCellEditingStopped={() => editing.finishCell()}
      onCellEditRequest={event => { void save({ id: event.data.id, text: String(event.newValue ?? '') }); }}
      theme={theme} loading={!status && !error} columnDefs={columns} rowData={status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      noRowsOverlayComponent={EmptyProject}
      noRowsOverlayComponentParams={{ message: error ? '暂时无法读取口播片段' : '暂无口播片段' }} /></AgGridProvider></div>
    <footer className="status-bar" aria-label="项目状态">
      <div className="status-line" role="status">
        <span>{error ? '服务连接失败' : status ? '本地服务已连接' : '正在连接本地服务…'}</span>
        <span className={`save-status${saveState === 'failed' ? ' save-error' : ''}`}>{saveState === 'saving' ? '保存中…' : saveState === 'failed' ? '保存失败' : status ? '已保存' : '等待读取项目'}</span>
        <button onClick={event => openDetail('diagnostics', event.currentTarget)}>连接诊断</button>
        <button onClick={event => openDetail('tasks', event.currentTarget)}>任务详情</button>
      </div>
      <p className="lock-status" role="status">{lock}</p>
      <p className="task-summary" role="status">
        {exportTask ? `${exportStateLabel[exportTask.state]} ${exportTask.completed}/${exportTask.total}` : '暂无导出任务'}
        {speechTask && ` · 配音：${({ accepted: '已受理', running: '生成中', succeeded: '生成成功', failed: '生成失败', unknown: '结果未知，可能已计费' })[speechTask.state]}`}
        {batchTask && ` · 批量配音：完成 ${batchTask.summary.completed}，待完成 ${batchTask.summary.pending}，失败 ${batchTask.summary.failed}，中断 ${batchTask.summary.interrupted}`}
      </p>
      {(error || saveError || exports.connectionError || exports.operationError || speechProblems.length > 0 || exportProblems.length > 0 || selectionState.includes('断开')) && <div className="status-errors" aria-label="操作异常">
        {error && <p role="alert">{error}</p>}
        {saveError && <p role={saveState === 'failed' ? 'alert' : 'status'}>{saveError}</p>}
        {exports.connectionError && <p role="alert">{exports.connectionError}</p>}
        {exports.operationError && <p role="alert">{exports.operationError}</p>}
        {speechProblems.length > 0 && <p role="alert">配音异常 {speechProblems.length} 项{speechProblems.some(task => task.state === 'unknown') ? ' · 结果未知，可能已计费' : ' · 生成失败'}，请查看任务详情</p>}
        {exportProblems.length > 0 && <p role="alert">导出失败或中断 {exportProblems.length} 项，请查看任务详情</p>}
        {selectionState.includes('断开') && <p role="alert">{selectionState} <button onClick={() => setConnectionVersion(version => version + 1)}>重新连接勾选</button></p>}
      </div>}
    </footer>
  </main>;
}
