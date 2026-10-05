import { panelServiceUrl } from './service-url.js';
import { Dialog } from './dialog.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { queryExportSettings, saveExportSettings } from '../shared/client.js';
import type { ExportSettings, ExportStatus, ServiceStatus } from '../shared/contracts.js';
import type { ProjectEditing } from './project-editing.js';

type Props = { onSaveState: (state: 'saved' | 'saving' | 'failed', message?: string) => void; restoreFocus: () => void; editing: ProjectEditing; status: ServiceStatus; onStatus: (status: ServiceStatus) => void; onClose: () => void };
export function ExportSettingsPanel({ editing, status, onStatus, onClose, restoreFocus, onSaveState }: Props) {
  const [details, setDetails] = useState<ExportStatus>();
  const [draft, setDraft] = useState<ExportSettings>(status.snapshot.exportSettings);
  const [size, setSize] = useState(status.snapshot.exportSettings.fontSize?.toString() ?? '');
  const activity = useSyncExternalStore(editing.subscribe, editing.getState);
  const owns = activity.owner === 'settings';
  const mode = owns && activity.busy ? 'saving' : owns && activity.editing ? 'editing' : 'view';
  const [message, setMessage] = useState('正在检查媒体组件与字体…');
  const saved = useRef(status.snapshot.exportSettings);
  const settingsKey = JSON.stringify(status.snapshot.exportSettings);
  useEffect(() => {
    let active = true;
    void queryExportSettings(panelServiceUrl()).then(result => {
      if (!active) return;
      setDetails(result);
      setMessage(current => current === '正在检查媒体组件与字体…' ? '设置按项目自动保存' : current);
    }).catch(error => { if (active) setMessage(current => current === '正在检查媒体组件与字体…' ? error.message : current); });
    return () => { active = false; };
  }, [settingsKey]);
  useEffect(() => () => { void editing.cancel('settings'); }, [editing]);
  const adopt = (settings: ExportSettings) => {
    saved.current = settings; setDraft(settings); setSize(settings.fontSize?.toString() ?? '');
  };
  const edit = () => editing.begin('settings', next => {
    onStatus(next); adopt(next.snapshot.exportSettings);
    setMessage('修改后自动保存；字号输入完成后离开输入框保存');
  }, () => {
    setSize(saved.current.fontSize?.toString() ?? '');
    onSaveState('failed', '编辑连接已断开，未提交输入已取消，请重新读取后编辑');
    setMessage(current => `${current === '已保存' || current.startsWith('保存失败：') ? current + '；' : ''}编辑连接已断开，未提交输入已取消，请重新读取后编辑`);
  }, error => setMessage(error.message));
  const save = (settings: ExportSettings) => {
    if (JSON.stringify(settings) === JSON.stringify(draft)) { setSize(draft.fontSize?.toString() ?? ''); return; }
    return editing.save('settings', { retain: true }, async (token, action) => {
      setMessage('保存中…'); onSaveState('saving');
      const result = await saveExportSettings(panelServiceUrl(), { expected: draft, settings }, token);
      action.apply(() => { adopt(result.settings); onStatus(result.status); setMessage('已保存'); onSaveState('saved'); });
    }, error => {
      setSize(saved.current.fontSize?.toString() ?? ''); setMessage(`保存失败：${error.message}`); onSaveState('failed', `保存失败：${error.message}`);
    });
  };
  const close = async () => {
    if (activity.busy) return;
    if (owns && size !== (draft.fontSize?.toString() ?? '')) {
      setMessage('字号尚未保存，请先离开输入框完成保存'); return;
    }
    if (!owns || await editing.cancel('settings')) onClose();
  };
  const disabled = mode !== 'editing';
  const settings = owns ? draft : status.snapshot.exportSettings;
  const issues = details?.issues ?? [];
  return <Dialog label="全片导出设置" onClose={() => { void close(); }} restoreFocus={restoreFocus}>
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
    <label>字幕字号（px）<input aria-label="字幕字号（px）" type="number" min="1" max="1080" step="1" disabled={disabled} value={owns ? size : status.snapshot.exportSettings.fontSize?.toString() ?? ''} onChange={event => setSize(event.target.value)} onBlur={() => { void save({ ...draft, fontSize: size.trim() === '' ? null : Number(size) }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <p>字号为 1080p 画布像素，范围 1–1080 的整数；字体与字号均须主动设置。字体来自本机 Fontconfig，安装字体后可关闭并重开此入口刷新。</p>
    {!!issues.length && <ul aria-label="导出设置待解决项">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p role="status">{message}</p>
    <div className="toolbar">
      {mode === 'view' && <button disabled={activity.busy || activity.editing || status.taskLocked || !!status.modification} onClick={() => { void edit(); }}>编辑设置</button>}
      <button disabled={mode === 'saving'} onClick={() => { void close(); }}>关闭设置</button>
    </div>
  </Dialog>;
}
