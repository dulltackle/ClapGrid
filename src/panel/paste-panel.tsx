import { Button, Textarea } from '@/components/ui/index.js';
import { DetailPanel } from './detail-panel.js';

/** 草稿与提交仍由主视图拥有；修改权获取及提交期间均禁止关闭。 */
export function PastePanel({ value, busy, disabled, error, onChange, onSubmit, onClose, restoreFocus }: {
  value: string;
  busy: boolean;
  disabled: boolean;
  error: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  return <DetailPanel title="粘贴多行文案" onClose={() => { if (!busy) onClose(); }} restoreFocus={restoreFocus}>
    {error && <p role="alert" className="m-0 text-destructive">{error}</p>}
    <Textarea aria-label="多行文案" className="shrink-0" value={value} disabled={busy} onChange={event => onChange(event.target.value)} placeholder="每个非空行创建一个口播片段" />
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={disabled || !value.trim()} onClick={onSubmit}>按非空行新增</Button>
      <Button variant="outline" size="sm" className="border-input text-foreground shrink-0" disabled={busy} onClick={onClose}>关闭</Button>
    </div>
  </DetailPanel>;
}
