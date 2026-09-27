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
const theme = themeQuartz.withParams({ accentColor: '#386b5b', fontFamily: 'system-ui, sans-serif', headerBackgroundColor: '#f0f3ef' });

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
    <header><div><p className="eyebrow">CLAPGRID</p><h1>口播片段</h1></div><span className="badge">工程骨架</span></header>
    <section className="connection" aria-live="polite">
      <strong>{error || (status ? '本地服务已连接' : '正在连接本地服务…')}</strong>
      {status && <><p className="path">{status.snapshot.project.directory}</p><p className="identity">服务实例 {status.instanceId} · PID {status.pid}</p></>}
    </section>
    <div className="grid"><AgGridProvider modules={[AllCommunityModule]}><AgGridReact
      theme={theme} columnDefs={columns} rowData={status?.snapshot.segments ?? []}
      defaultColDef={{ editable: false, sortable: false, resizable: true }}
      overlayNoRowsTemplate="<span>暂无口播片段</span>" /></AgGridProvider></div>
    <footer>工程初始化验证 · 片段编辑、配音与导出尚未实现</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
