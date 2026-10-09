import { Button, NativeSelect } from '@/components/ui/index.js';
import type { SpeechStatus, Voice } from '../shared/contracts.js';
import { DetailPanel } from './detail-panel.js';

/** 声音立即保存；关闭限制及编辑占用继续由主视图的业务状态决定。 */
export function VoicePanel({ speech, disabled, busy, error, onChange, onClose, restoreFocus }: {
  speech: SpeechStatus;
  disabled: boolean;
  busy: boolean;
  error?: string;
  onChange: (voice: Voice) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const close = () => { if (!busy) onClose(); };
  return <DetailPanel title="统一声音设置" onClose={close} restoreFocus={restoreFocus}
    description={`文案通过 TokenDance seed-tts-2.0 生成配音，可能产生费用。配置位置：${speech.configPath}，键名 TOKENDANCE_KEY。已配置不代表服务已验证。`}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 basis-48 flex-col gap-2 text-sm">统一音色
        <NativeSelect aria-label="统一音色" disabled={disabled} value={speech.voice.speaker} onChange={event => onChange({ ...speech.voice, speaker: event.target.value as Voice['speaker'] })}>
          <option value="zh_female_vv_uranus_bigtts">vivi 2.0</option>
          <option value="zh_female_santongyongns_saturn_bigtts">流畅女声</option>
          <option value="zh_male_ruyayichen_saturn_bigtts">儒雅逸辰</option>
        </NativeSelect>
      </label>
      <label className="flex min-w-0 flex-1 basis-48 flex-col gap-2 text-sm">统一语速 {(1 + speech.voice.speechRate / 100).toFixed(2)} 倍
        <NativeSelect aria-label="统一语速" disabled={disabled} value={speech.voice.speechRate} onChange={event => onChange({ ...speech.voice, speechRate: Number(event.target.value) })}>
          {Array.from({ length: 151 }, (_, index) => index - 50).map(rate => <option key={rate} value={rate}>{(1 + rate / 100).toFixed(2)} 倍</option>)}
        </NativeSelect>
      </label>
      <span className="text-[12px] text-muted-foreground">TokenDance 凭据：{speech.configured ? '已配置' : '未配置'}</span>
    </div>
    {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
    <Button variant="outline" size="sm" className="shrink-0 self-start border-input text-foreground" disabled={busy} onClick={close}>关闭声音设置</Button>
  </DetailPanel>;
}
