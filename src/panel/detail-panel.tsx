import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.js';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/index.js';
import { restorePanelFocus } from './dialog-focus.js';

/** 更多与只读详情共享关闭规则；切换面板时把焦点交给已打开的浮层。 */
export function DetailPanel({ title, label, description, className, onClose, restoreFocus, restoreWithinLayer = false, children }: {
  title: string;
  label?: string;
  description?: string;
  className?: string;
  onClose: () => void;
  restoreFocus: () => void;
  /** 嵌套业务恢复原入口后，仍将焦点约束在剩余最上层。 */
  restoreWithinLayer?: boolean;
  children: ReactNode;
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-label={label} {...(!description ? { 'aria-describedby': undefined } : {})} className={cn("gap-3 [overflow-wrap:anywhere]", className)} onCloseAutoFocus={event => {
      event.preventDefault();
      restorePanelFocus(restoreFocus, restoreWithinLayer);
    }}>
      <DialogTitle className="m-0 text-[18px] font-semibold">{title}</DialogTitle>
      {description && <DialogDescription className="m-0 text-[12px] text-muted-foreground">{description}</DialogDescription>}
      {children}
    </DialogContent>
  </Dialog>;
}
