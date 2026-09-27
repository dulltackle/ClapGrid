import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AllCommunityModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { queryStatus } from '../shared/client.js';
import type { ServiceStatus } from '../shared/contracts.js';
import './style.css';

const columns: ColDef[] = [
  { headerName: '顺序', width: 80 },
  { headerName: '文案', flex: 1, minWidth: 200 },
  { headerName: '关联视频', width: 150 },
  { headerName: '视频起点', width: 110 },
  { headerName: '配音可用性', width: 140 },
  { headerName: '任务状态', width: 130 },
];
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
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await queryStatus(window.location.origin);
        if (active) { setStatus(next); setError(''); }
      } catch {
        if (active) { setStatus(undefined); setError('服务连接失败，请通过 Codex 检查本地服务。'); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <main>
    <header><h1>口播片段</h1></header>
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
      theme={theme} loading={!status && !error} columnDefs={columns} rowData={status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayLoadingTemplate="<span>正在连接本地服务…</span>"
      overlayNoRowsTemplate={error ? '<span>暂时无法读取口播片段</span>' : '<span>暂无口播片段</span>'} /></AgGridProvider></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
