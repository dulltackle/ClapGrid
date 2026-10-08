import { useEffect, useId, useRef } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { Segment } from '../shared/contracts.js';

/** 只负责全文输入；提交、取消与修改权继续由表格及既有编辑会话管理。 */
export function TextEditor({ value, onValueChange, stopEditing }: CustomCellEditorProps<Segment, string>) {
  const input = useRef<HTMLTextAreaElement>(null);
  const hint = useId();
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <div className="w-[min(560px,calc(100vw-32px))] rounded-md border border-solid border-input bg-background p-2 shadow-[0_4px_16px_#0002]">
    <textarea className="m-0 block h-[min(240px,45dvh)] min-h-0 w-full resize-none rounded-md border border-solid border-input bg-background px-2 py-1 font-[inherit] leading-[22px] text-foreground" ref={input} aria-label="文案全文" aria-describedby={hint} value={value ?? ''}
      onChange={event => onValueChange(event.target.value)}
      onBlur={() => {
        // Esc／断线关闭也会触发失焦，等表格完成取消后仅结束仍存活的编辑器。
        queueMicrotask(() => { if (input.current?.isConnected && document.activeElement !== input.current) stopEditing(); });
      }}
      onKeyDownCapture={event => {
        // 保留文本框内导航、换行和中文输入法确认，其余按键交由 AG Grid 处理。
        if (event.nativeEvent.isComposing || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
          || (event.key === 'Enter' && event.shiftKey)) event.stopPropagation();
      }} />
    <p className="mt-2 mb-0 whitespace-normal text-[12px] leading-[18px] text-muted-foreground" id={hint}>Enter 保存 · Esc 取消 · Shift+Enter 换行</p>
  </div>;
}
