import { panelServiceUrl } from './service-url.js';
import { Button, Input, NativeSelect, Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/index.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { queryExportSettings, saveExportSettings, setBackgroundMusic } from '../shared/client.js';
import type { ExportSettings, ExportStatus, ServiceStatus } from '../shared/contracts.js';
import type { ProjectEditing } from './project-editing.js';

type Props = { onError: (message: string) => void; restoreFocus: () => void; editing: ProjectEditing; status: ServiceStatus; onStatus: (status: ServiceStatus) => void; onClose: () => void };
export function ExportSettingsPanel({ editing, status, onStatus, onClose, restoreFocus, onError }: Props) {
  const [details, setDetails] = useState<ExportStatus>();
  const [draft, setDraft] = useState<ExportSettings>(status.snapshot.exportSettings);
  const activity = useSyncExternalStore(editing.subscribe, editing.getState);
  const owns = activity.owner === 'settings';
  const mode = owns && activity.busy ? 'saving' : owns && activity.editing ? 'editing' : 'view';
  const [message, setMessage] = useState('正在检查媒体组件…');
  const errorVersion = useRef(0);
  const reportError = (message: string) => { errorVersion.current++; onError(message); };
  const settingsKey = JSON.stringify(status.snapshot.exportSettings);
  useEffect(() => {
    let active = true;
    const version = errorVersion.current;
    void queryExportSettings(panelServiceUrl()).then(result => {
      if (!active) return;
      setDetails(result);
      setMessage(current => current === '正在检查媒体组件…' ? '设置按项目自动保存' : current);
    }).catch(error => { if (active) { setMessage(current => current === '正在检查媒体组件…' ? error.message : current); if (version === errorVersion.current) onError(error.message); } });
    return () => { active = false; };
  }, [settingsKey]);
  useEffect(() => () => { void editing.cancel('settings'); }, [editing]);
  const edit = () => editing.begin('settings', next => {
    onStatus(next); setDraft(next.snapshot.exportSettings);
    setMessage('修改后自动保存');
  }, () => {
    reportError('编辑连接已断开，未提交输入已取消，请重新读取后编辑');
    setMessage(current => `${current === '已保存' || current.startsWith('保存失败：') ? current + '；' : ''}编辑连接已断开，未提交输入已取消，请重新读取后编辑`);
  }, error => { setMessage(error.message); reportError(error.message); });
  const persist = (write: (token: string, signal: AbortSignal) => Promise<{ status: ServiceStatus }>) =>
    editing.save('settings', { retain: true }, async (token, action) => {
      setMessage('保存中…'); reportError('');
      const result = await write(token, action.signal);
      action.apply(() => { setDraft(result.status.snapshot.exportSettings); onStatus(result.status); setMessage('已保存'); reportError(''); });
    }, error => { setMessage(`保存失败：${error.message}`); reportError(`保存失败：${error.message}`); });
  const save = (settings: ExportSettings) => {
    if (JSON.stringify(settings) === JSON.stringify(draft)) return;
    return persist(token => saveExportSettings(panelServiceUrl(), { expected: draft, settings }, token));
  };
  const music = status.snapshot.backgroundMusic;
  const saveMusic = (file: File | null) => persist((token, signal) => {
    const expected = music?.id ?? null;
    return setBackgroundMusic(panelServiceUrl(), file ? { expected, file } : { expected, sourcePath: null }, token, signal);
  });
  const close = async () => {
    if (activity.busy) return;
    if (!owns || await editing.cancel('settings')) onClose();
  };
  const disabled = mode !== 'editing';
  const settings = owns ? draft : status.snapshot.exportSettings;
  const issues = details?.issues ?? [];
  return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
    <DialogContent className="gap-3 [overflow-wrap:anywhere] [&>*]:shrink-0" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
    <DialogTitle className="m-0 text-lg font-semibold">全片导出设置</DialogTitle>
    <p className="m-0">适用于全片 · 16:9 · 1920×1080 · MP4</p>
    <DialogDescription className="m-0">修改设置不会生成配音或更改已有成片，下一次导出采用当前设置。</DialogDescription>
    <label className="flex min-w-0 flex-col gap-1">编码<NativeSelect aria-label="导出编码" disabled={disabled} value={settings.codec} onChange={event => { void save({ ...draft, codec: event.target.value as ExportSettings['codec'] }); }}>
      <option value="libx264">H.264（默认）</option><option value="mpeg4">MPEG-4 Part 2</option>
    </NativeSelect></label>
    <label className="flex min-w-0 flex-col gap-1">帧率<NativeSelect aria-label="导出帧率" disabled={disabled} value={settings.fps} onChange={event => { void save({ ...draft, fps: Number(event.target.value) as ExportSettings['fps'] }); }}>
      {[24, 25, 30, 50, 60].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
    </NativeSelect></label>
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p className="m-0">{music ? `背景乐 ${music.name}` : '未设置背景乐'} · 仅用于全片导出</p>
      <label className="flex w-full flex-col gap-1">选择背景乐文件
        <Input type="file" accept="audio/*,.m4a,.mkv,.webm" disabled={disabled} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void saveMusic(file);
        }} />
      </label>
      {music && <Button variant="outline" size="sm" disabled={disabled} onClick={() => { void saveMusic(null); }}>移除背景乐</Button>}
    </div>
    <p className="m-0">{status.snapshot.projectStyle ? `项目风格 ${status.snapshot.projectStyle.id} · ${status.snapshot.projectStyle.version}` : '未设置项目风格，无法导出'}</p>
    {!!issues.length && <ul className="m-0 list-disc pl-5" aria-label="导出设置待解决项">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p className="m-0" role="status">{message}</p>
    <div className="flex flex-wrap items-center gap-2">
      {mode === 'view' && <Button variant="outline" disabled={activity.busy || activity.editing || status.taskLocked || !!status.modification} onClick={() => { void edit(); }}>编辑设置</Button>}
      <Button variant="outline" disabled={mode === 'saving'} onClick={() => { void close(); }}>关闭设置</Button>
    </div>
    </DialogContent>
  </Dialog>;
}
