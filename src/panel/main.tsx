import { StrictMode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus, importVideo, saveSegment, beginEdit, type EditSession, connectTable, modifyUserBatch, type TableSession } from '../shared/client.js';
import type { Segment, ServiceStatus, Batch } from '../shared/contracts.js';
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
  rowHeight: 40,
});

function App() {
  const [status, setStatus] = useState<ServiceStatus>();
  const [error, setError] = useState('');
  const [videoEditor, setVideoEditor] = useState<{ segment: Segment; assetId: string; start: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [preview, setPreview] = useState<{ assetId: string; start: number } | null>(null);
  const importController = useRef<AbortController | null>(null);
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionState, setSelectionState] = useState('正在连接勾选…');
  const [connectionVersion, setConnectionVersion] = useState(0);
  const table = useRef<TableSession | null>(null);
  const selectionVersion = useRef(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [saveError, setSaveError] = useState('');
  const pending = useRef(false);
  const editing = useRef(false);
  const generation = useRef(0);
  const session = useRef<EditSession | null>(null);
  const grid = useRef<GridApi<Segment> | null>(null);
  const mounted = useRef(true);
  const release = async () => {
    const previous = session.current;
    session.current = null;
    editing.current = false;
    if (previous) await previous.close().catch(() => {});
  };
  const acquire = async () => {
    const next = await beginEdit(window.location.origin);
    if (!mounted.current) { await next.close(); throw new Error('面板已关闭'); }
    session.current = next;
    void next.closed.then(() => {
      if (session.current !== next || pending.current) return;
      session.current = null; editing.current = false;
      setVideoEditor(null); setImporting(false);
      grid.current?.stopEditing(true);
      setSaveState('failed'); setSaveError('编辑连接已断开，未提交输入已取消；请重新读取后编辑。');
    });
    return next;
  };
  const startEdit = async (id: string) => {
    if (pending.current || editing.current) return;
    pending.current = true; generation.current++;
    try {
      const next = await acquire();
      flushSync(() => { setStatus(next.status); setError(''); setSaveError(''); setSaveState('saved'); });
      const row = grid.current?.getRowNode(id);
      if (row?.rowIndex == null) throw new Error('口播片段已删除，请选择其他片段。');
      pending.current = false;
      editing.current = true;
      grid.current?.startEditingCell({ rowIndex: row.rowIndex, colKey: 'text' });
    } catch (cause) {
      await release();
      const message = cause instanceof Error ? cause.message : '无法开始编辑';
      if (message === 'Codex 正在修改' || message === '用户正在编辑') {
        const latest = await queryStatus(window.location.origin).catch(() => undefined);
        if (latest) setStatus(latest);
        setSaveState('saved');
      } else { setSaveState('failed'); setSaveError(message); }
    } finally { pending.current = false; }
  };
  const columns: ColDef<Segment>[] = [
    { headerName: '序号', field: 'order', width: 80, sortable: true },
    { headerName: '文案', field: 'text', sortable: true, flex: 1, minWidth: 200, editable: () => !!session.current && !pending.current && !error,
      suppressKeyboardEvent: params => {
        if (params.editing && params.event.key === 'Tab') { params.api.stopEditing(); return true; }
        return !params.editing && (['Enter', 'F2', 'Backspace', 'Delete'].includes(params.event.key) || params.event.key.length === 1);
      } },
    { headerName: '画面素材', width: 310, cellRenderer: (params: { data?: Segment }) => {
      const segment = params.data;
      if (!segment) return null;
      const asset = status?.snapshot.assets.find(asset => asset.id === segment.video?.assetId);
      return <div className="video-cell">
        {asset && <button className="thumbnail" aria-label={`播放 ${asset.name}`} onClick={() => setPreview(segment.video)}>
          <img src={`/api/media/${asset.id}/thumbnail`} alt={asset.name} />
        </button>}
        <span>{asset ? `${asset.name} · ${segment.video!.start} 秒` : '未关联视频'}</span>
        <button disabled={disabled} onClick={() => { void openVideoEditor(segment.id); }}>{asset ? '更改' : '关联'}</button>
      </div>;
    } },
    { headerName: '配音', width: 140 },
    { headerName: '画面说明', width: 180 },
  ];
  const save = async (change: { id?: string; text: string }) => {
    if (pending.current) return;
    pending.current = true;
    generation.current++;
    setSaveState('saving'); setSaveError('');
    try {
      if (change.id && !session.current) throw new Error('修改权已失效，请重新读取后编辑。');
      const lease = session.current ?? await acquire();
      const next = await saveSegment(window.location.origin, change, lease.token);
      setStatus(next); setError(''); setSaveState('saved');
    } catch (cause) {
      setSaveState('failed');
      setSaveError(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败：未能确认保存结果，请核对表格后重新编辑；不会自动重试。');
    } finally {
      await release();
      pending.current = false;
    }
  };
  const organize = async (batch: Batch) => {
    if (pending.current || editing.current) return;
    pending.current = true; generation.current++;
    setSaveState('saving'); setSaveError('');
    try {
      const lease = await acquire();
      const result = await modifyUserBatch(window.location.origin, batch, lease.token);
      setStatus(result.status); setError('');
      const unsuccessful = result.results.filter(item => item.outcome !== 'applied');
      if (unsuccessful.length) throw new Error(unsuccessful.map(item => item.message).join('；'));
      setSaveState('saved');
      if (batch.changes.some(change => change.kind === 'paste')) setPaste('');
    } catch (cause) {
      setSaveState('failed'); setSaveError(cause instanceof Error ? cause.message : '未确认保存结果，请查询后再操作');
    } finally { await release(); pending.current = false; }
  };
  const openVideoEditor = async (id?: string) => {
    if (pending.current || editing.current) return;
    pending.current = true; generation.current++;
    try {
      const lease = await acquire();
      setStatus(lease.status); setSaveError(''); setSaveState('saved');
      editing.current = true;
      if (id) {
        const segment = lease.status.snapshot.segments.find(segment => segment.id === id);
        if (!segment) throw new Error('口播片段已删除');
        setVideoEditor({ segment, assetId: segment.video?.assetId ?? '', start: String(segment.video?.start ?? 0) });
      } else { setSourcePath(''); setImporting(true); }
    } catch (cause) {
      await release(); setSaveState('failed'); setSaveError((cause as Error).message);
    } finally { pending.current = false; }
  };
  const cancelVideo = async () => {
    importController.current?.abort();
    setVideoEditor(null); setImporting(false);
    await release(); generation.current++;
  };
  const saveVideo = async () => {
    if (pending.current || !session.current) return;
    pending.current = true; generation.current++; setSaveState('saving'); setSaveError('');
    try {
      const controller = new AbortController(); importController.current = controller;
      if (importing) {
        const result = await importVideo(window.location.origin, sourcePath, session.current.token, controller.signal);
        setStatus(result.status);
      } else if (videoEditor) {
        if (!videoEditor.start.trim()) throw new Error('请填写视频起点');
        const result = await modifyUserBatch(window.location.origin, { changes: [{ kind: 'video', expected: videoEditor.segment,
          assetId: videoEditor.assetId || null, start: Number(videoEditor.start) }] }, session.current.token, controller.signal);
        setStatus(result.status);
        if (result.summary.applied !== 1) throw new Error(result.results[0]?.message ?? '关联未保存');
      }
      setSaveState('saved');
    } catch (cause) { setSaveState('failed'); setSaveError((cause as Error).message); }
    finally {
      importController.current = null; setVideoEditor(null); setImporting(false);
      await release(); pending.current = false;
    }
  };
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
    let active = true; mounted.current = true;
    const refresh = async () => {
      if (pending.current || editing.current) return;
      const version = generation.current;
      try {
        const next = await queryStatus(window.location.origin);
        if (active && version === generation.current && !editing.current) { setStatus(next); setError(''); }
      } catch {
        if (active && version === generation.current && !editing.current) { setStatus(undefined); setError('服务连接失败，请通过 Codex 检查本地服务。'); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    const leave = () => { void release(); };
    window.addEventListener('pagehide', leave);
    return () => { active = false; mounted.current = false; clearInterval(timer); window.removeEventListener('pagehide', leave); void release(); };
  }, []);
  const disabled = !status || saveState === 'saving' || !!status.modification || editing.current;
  const selectedPosition = status?.snapshot.segments.findIndex(segment => segment.id === selectedIds[0]) ?? -1;
  return <main>
    <header><h1>口播片段</h1>
      <button disabled={disabled} onClick={() => { void openVideoEditor(); }}>导入本地视频</button>
      <button disabled={!status || saveState === 'saving' || !!status.modification || editing.current} onClick={() => { void save({ text: '' }); }}>新增口播片段</button>
    </header>
    <p className={`save-status${saveState === 'failed' ? ' save-error' : ''}`} role="status">
      {saveState === 'saving' ? '保存中…' : saveState === 'failed' ? saveError : status?.modification?.owner === 'codex' ? 'Codex 正在修改' : status?.modification?.owner === 'user' ? '用户正在编辑' : status ? '已保存' : '等待读取项目'}
    </p>
    <section className={`connection${error ? ' connection-error' : ''}`} aria-label="服务连接">
      <p className="connection-status" role="status">{error || (status ? '本地服务已连接' : '正在连接本地服务…')}</p>
      {status && <details className="diagnostics">
        <summary>诊断信息</summary>
        <dl>
          <dt>项目路径</dt><dd>{status.snapshot.project.directory}</dd>
          <dt>服务实例</dt><dd>{status.instanceId}</dd>
          <dt>PID</dt><dd>{status.pid}</dd>
        </dl>
      </details>}
    </section>
    <section className="organization" aria-label="组织口播片段">
      <div className="toolbar">
        <label>筛选文案 <input aria-label="筛选文案" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <span>已勾选 {selectedIds.length} 个片段（含筛选隐藏项）</span>
        <button disabled={disabled || !selectedIds.length} onClick={() => {
          const targets = status!.snapshot.segments.filter(segment => selectedIds.includes(segment.id));
          void organize({ changes: targets.map(expected => ({ kind: 'delete', expected })) });
        }}>删除勾选</button>
        <button disabled={disabled || selectedIds.length !== 1 || selectedPosition <= 0} onClick={() => move(-1)}>项目顺序上移</button>
        <button disabled={disabled || selectedIds.length !== 1 || selectedPosition < 0 || selectedPosition >= (status?.snapshot.segments.length ?? 0) - 1} onClick={() => move(1)}>项目顺序下移</button>
      </div>
      <p className="selection-status" role="status">{selectionState}
        {selectionState.includes('断开') && <button onClick={() => setConnectionVersion(version => version + 1)}>重新连接勾选</button>}
      </p>
      <details><summary>粘贴多行文案</summary>
        <textarea aria-label="多行文案" value={paste} onChange={event => setPaste(event.target.value)} placeholder="每个非空行创建一个口播片段" />
        <button disabled={disabled || !paste.trim()} onClick={() => { void organize({ changes: [{ kind: 'paste', text: paste }] }); }}>按非空行新增</button>
      </details>
    </section>
    {(videoEditor || importing) && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={importing ? '导入本地视频' : '关联视频'} className="media-dialog">
      <h2>{importing ? '导入本地视频' : '关联视频'}</h2>
      {importing ? <label>视频文件绝对路径<input autoFocus aria-label="视频文件绝对路径" value={sourcePath} disabled={saveState === 'saving'} onChange={event => setSourcePath(event.target.value)} placeholder="粘贴要导入的本地视频完整路径" /></label>
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
    </section></div>}
    {preview && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="视频预览" className="media-dialog">
      <h2>视频预览</h2><video key={preview.assetId} controls muted autoPlay src={`/api/media/${preview.assetId}/preview`} onLoadedMetadata={event => { event.currentTarget.currentTime = preview.start; }} onError={() => { setSaveError('预览不可用，请检查项目素材文件'); setSaveState('failed'); }} />
      <p>从 {preview.start} 秒开始，预览默认静音。</p><button onClick={() => setPreview(null)}>关闭预览</button>
    </section></div>}
    <div className="grid"><AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      readOnlyEdit stopEditingWhenCellsLoseFocus suppressClickEdit
      rowSelection={{ mode: 'multiRow', selectAll: 'filtered', enableClickSelection: false }}
      quickFilterText={filter}
      onSelectionChanged={event => synchronizeSelection(event.api.getSelectedRows().map(segment => segment.id))}
      onGridReady={event => { grid.current = event.api; }}
      onCellDoubleClicked={event => { if (event.colDef.field === 'text' && event.data) void startEdit(event.data.id); }}
      onCellKeyDown={event => {
        const key = (event.event as KeyboardEvent).key;
        if ('colDef' in event && event.colDef.field === 'text' && event.data && !editing.current && (['Enter', 'F2'].includes(key) || key.length === 1)) void startEdit(event.data.id);
      }}
      getRowId={params => params.data.id}
      onCellEditingStarted={() => { editing.current = true; generation.current++; }}
      onCellEditingStopped={() => {
        editing.current = false;
        queueMicrotask(() => { if (!pending.current) { void release(); generation.current++; } });
      }}
      onCellEditRequest={event => { void save({ id: event.data.id, text: String(event.newValue ?? '') }); }}
      theme={theme} loading={!status && !error} columnDefs={columns} rowData={status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      overlayNoRowsTemplate={error ? '<span>暂时无法读取口播片段</span>' : '<span>暂无口播片段</span>'} /></AgGridProvider></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
