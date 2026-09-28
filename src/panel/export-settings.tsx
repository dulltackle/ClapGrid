import { useEffect, useRef, useState } from 'react';
import { beginEdit, queryExportSettings, queryStatus, saveExportSettings, type EditSession } from '../shared/client.js';
import type { ExportSettings, ExportStatus, ServiceStatus } from '../shared/contracts.js';

type Props = { status: ServiceStatus; onStatus: (status: ServiceStatus) => void; onClose: () => void };
export function ExportSettingsPanel({ status, onStatus, onClose }: Props) {
  const [details, setDetails] = useState<ExportStatus>();
  const [draft, setDraft] = useState<ExportSettings>(status.snapshot.exportSettings);
  const [size, setSize] = useState(status.snapshot.exportSettings.fontSize?.toString() ?? '');
  const [mode, setMode] = useState<'view' | 'editing' | 'saving'>('view');
  const [message, setMessage] = useState('正在检查媒体组件与字体…');
  const session = useRef<EditSession | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const settingsKey = JSON.stringify(status.snapshot.exportSettings);
  useEffect(() => {
    let active = true;
    void queryExportSettings(window.location.origin).then(result => {
      if (!active) return;
      setDetails(result);
      setMessage(current => current === '正在检查媒体组件与字体…' ? '设置按项目自动保存' : current);
      if (!session.current) { setDraft(result.settings); setSize(result.settings.fontSize?.toString() ?? ''); }
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [settingsKey]);
  useEffect(() => {
    alive.current = true;
    const release = () => { const previous = session.current; session.current = null; void previous?.close().catch(() => {}); };
    window.addEventListener('pagehide', release);
    return () => { alive.current = false; window.removeEventListener('pagehide', release); release(); };
  }, []);
  const edit = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await beginEdit(window.location.origin);
      if (!alive.current) { await next.close(); return; }
      session.current = next;
      onStatus(next.status); setDraft(next.status.snapshot.exportSettings); setSize(next.status.snapshot.exportSettings.fontSize?.toString() ?? '');
      setMode('editing'); setMessage('修改后自动保存；字号输入完成后离开输入框保存');
      void next.closed.then(() => {
        if (!alive.current || session.current !== next) return;
        session.current = null; setMode('view'); setMessage('编辑连接已断开，未提交输入已取消，请重新读取后编辑');
      });
    } catch (error) { setMessage((error as Error).message); }
    finally { busy.current = false; }
  };
  const save = async (settings: ExportSettings) => {
    const current = session.current;
    if (!current || busy.current) return;
    if (JSON.stringify(settings) === JSON.stringify(draft)) { setSize(draft.fontSize?.toString() ?? ''); return; }
    busy.current = true; setMode('saving'); setMessage('保存中…');
    try {
      const result = await saveExportSettings(window.location.origin, { expected: draft, settings }, current.token);
      if (!alive.current) return;
      setDraft(result.settings); setSize(result.settings.fontSize?.toString() ?? ''); onStatus(result.status); setMessage('已保存');
    } catch (error) {
      if (alive.current) { setSize(draft.fontSize?.toString() ?? ''); setMessage(`保存失败：${(error as Error).message}`); }
    } finally { busy.current = false; if (alive.current) setMode(session.current ? 'editing' : 'view'); }
  };
  const close = async () => {
    if (busy.current) return;
    if (session.current && size !== (draft.fontSize?.toString() ?? '')) {
      setMessage('字号尚未保存，请先离开输入框完成保存'); return;
    }
    const previous = session.current; session.current = null;
    await previous?.close().catch(() => {});
    const latest = await queryStatus(window.location.origin).catch(() => undefined);
    if (latest) onStatus(latest);
    onClose();
  };
  const disabled = mode !== 'editing';
  const settings = session.current ? draft : status.snapshot.exportSettings;
  const issues = details?.issues ?? [];
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="全片导出设置" className="media-dialog">
    <h2>全片导出设置</h2>
    <p>适用于全片 · 16:9 · 1920×1080 · MP4</p>
    <p>修改设置不会生成配音或更改已有成片，下一次导出采用当前设置。</p>
    <label>编码<select aria-label="导出编码" disabled={disabled} value={settings.codec} onChange={event => { void save({ ...draft, codec: event.target.value as ExportSettings['codec'] }); }}>
      <option value="libx264">H.264（默认）</option><option value="mpeg4">MPEG-4 Part 2</option>
    </select></label>
    <label>帧率<select aria-label="导出帧率" disabled={disabled} value={settings.fps} onChange={event => { void save({ ...draft, fps: Number(event.target.value) as ExportSettings['fps'] }); }}>
      {[24, 25, 30, 50, 60].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
    </select></label>
    <label>字幕字体<select aria-label="字幕字体" disabled={disabled || !details} value={settings.fontFamily ?? ''} onChange={event => { void save({ ...draft, fontFamily: event.target.value || null }); }}>
      <option value="">未设置，请选择字体</option>
      {settings.fontFamily && !details?.fonts.includes(settings.fontFamily) && <option value={settings.fontFamily}>{settings.fontFamily}（当前不可用）</option>}
      {details?.fonts.map(font => <option key={font} value={font}>{font}</option>)}
    </select></label>
    <label>字幕字号（px）<input aria-label="字幕字号（px）" type="number" min="1" max="1080" step="1" disabled={disabled} value={size} onChange={event => setSize(event.target.value)} onBlur={() => { void save({ ...draft, fontSize: size.trim() === '' ? null : Number(size) }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <p>字号为 1080p 画布像素，范围 1–1080 的整数；字体与字号均须主动设置。字体来自本机 Fontconfig，安装字体后可关闭并重开此入口刷新。</p>
    {!!issues.length && <ul aria-label="导出设置待解决项">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p role="status">{message}</p>
    <div className="toolbar">
      {mode === 'view' && <button disabled={status.taskLocked || !!status.modification} onClick={() => { void edit(); }}>编辑设置</button>}
      <button disabled={mode === 'saving'} onClick={() => { void close(); }}>关闭设置</button>
    </div>
  </section></div>;
}
