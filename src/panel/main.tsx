import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AllCommunityModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus, saveSegment } from '../shared/client.js';
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
  const columns: ColDef<Segment>[] = [
    { headerName: '序号', field: 'order', width: 80 },
    { headerName: '文案', field: 'text', flex: 1, minWidth: 200, editable: () => !pending.current && !error },
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
      const next = await saveSegment(window.location.origin, change);
      setStatus(next); setError(''); setSaveState('saved');
    } catch (cause) {
      setSaveState('failed');
      setSaveError(cause instanceof Error && cause.message.startsWith('保存失败') ? cause.message : '保存失败：未能确认保存结果，请核对表格后重新编辑；不会自动重试。');
    } finally {
      pending.current = false;
    }
  };
  useEffect(() => {
    let active = true;
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
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <main>
    <header><h1>口播片段</h1>
      <button disabled={!status || saveState === 'saving'} onClick={() => { void save({ text: '' }); }}>新增口播片段</button>
    </header>
    <p className={`save-status${saveState === 'failed' ? ' save-error' : ''}`} role="status">
      {saveState === 'saving' ? '保存中…' : saveState === 'failed' ? saveError : status ? '已保存' : '等待读取项目'}
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
      readOnlyEdit stopEditingWhenCellsLoseFocus
      getRowId={params => params.data.id}
      onCellEditingStarted={() => { editing.current = true; generation.current++; }}
      onCellEditingStopped={() => { editing.current = false; }}
      onCellEditRequest={event => { void save({ id: event.data.id, text: String(event.newValue ?? '') }); }}
      theme={theme} loading={!status && !error} columnDefs={columns} rowData={status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      overlayNoRowsTemplate={error ? '<span>暂时无法读取口播片段</span>' : '<span>暂无口播片段</span>'} /></AgGridProvider></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
