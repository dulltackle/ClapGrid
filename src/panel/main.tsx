import { StrictMode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus, saveSegment, beginEdit, type EditSession } from '../shared/client.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
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
    { headerName: '序号', field: 'order', width: 80 },
    { headerName: '文案', field: 'text', flex: 1, minWidth: 200, editable: () => !!session.current && !pending.current && !error,
      suppressKeyboardEvent: params => {
        if (params.editing && params.event.key === 'Tab') { params.api.stopEditing(); return true; }
        return !params.editing && (['Enter', 'F2', 'Backspace', 'Delete'].includes(params.event.key) || params.event.key.length === 1);
      } },
    { headerName: '画面素材', width: 150 },
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
  return <main>
    <header><h1>口播片段</h1>
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
    <div className="grid"><AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      readOnlyEdit stopEditingWhenCellsLoseFocus suppressClickEdit
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
