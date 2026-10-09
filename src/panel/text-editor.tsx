import { useEffect, useRef } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { Segment } from '../shared/contracts.js';

/** 只负责全文输入；提交、取消与修改权继续由表格及既有编辑会话管理。 */
export function TextEditor({ value, onValueChange, stopEditing }: CustomCellEditorProps<Segment, string>) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <div className="h-full w-full py-1">
    <textarea className="m-0 block h-full min-h-0 w-full resize-none rounded-md border border-solid border-input bg-background px-2 py-1 font-[inherit] leading-[22px] text-foreground" ref={input} aria-label="文案全文" value={value ?? ''}
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
  </div>;
}
