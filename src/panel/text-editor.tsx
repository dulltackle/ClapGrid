import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, EnterFullScreenIcon, ExitFullScreenIcon, ResetIcon } from '@radix-ui/react-icons';
import { Button, Dialog, DialogContent, DialogTitle } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';

/** 原位输入和放大视图共用表格草稿，切换尺寸不提交、不重新取得修改权。 */
export function TextEditor({ value, field, data, support, speech, change, commit, cancel, busy }: { value: string; field: 'text' | 'visualNote'; data: Segment; support?: ReactNode; speech?: ReactNode; change: (value: string) => void; commit: () => void; cancel: () => void; busy: boolean }) {
  // AG Grid 的 renderer 参数异步刷新；输入立即回显，同时同步到共享草稿。
  const [text, setText] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const enlargedInput = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const selection = useRef({ start: 0, end: 0 });
  const label = field === 'visualNote' ? '画面说明' : '文案';
  const initialized = useRef(false);
  useEffect(() => { if (!busy && !initialized.current) { initialized.current = true; input.current?.focus(); input.current?.select(); } }, [busy]);
  const rememberSelection = (element: HTMLTextAreaElement | null) => {
    if (element) selection.current = { start: element.selectionStart, end: element.selectionEnd };
  };
  const focusInput = (element: HTMLTextAreaElement | null) => {
    if (!element?.isConnected) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(selection.current.start, selection.current.end);
  };
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => { focusInput(enlargedInput.current); });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const expand = () => { rememberSelection(input.current); setExpanded(true); };
  const collapse = () => { rememberSelection(enlargedInput.current); setExpanded(false); };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); event.stopPropagation(); commit(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (expandedRef.current) collapse(); else cancel(); return; }
    if (event.key === 'Tab' || event.key === ' ') event.stopPropagation();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) event.stopPropagation();
  };
  return <div data-inline-editor onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !expandedRef.current) {
      event.preventDefault(); event.stopPropagation(); cancel();
    }
  }} className="flex h-full w-full min-w-0 flex-col pb-1">
    <div className="flex min-h-0 flex-1 items-center gap-3">
      <div data-inline-text-box className="relative h-full min-w-0 flex-1">
        <textarea className="m-0 block h-full min-h-0 w-full resize-none rounded-md border border-solid border-input bg-background py-0 pl-2 pr-[88px] font-[inherit] text-[15px] leading-5 text-foreground outline-none" ref={input} aria-label={`${label}全文`} value={text}
          readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
        <div role="group" aria-label="文案编辑操作" className="absolute right-1 top-1.5 flex gap-0.5 rounded-md bg-background">
          <Button variant="ghost" size="xs" className="size-6 p-0 text-muted-foreground" aria-label="取消修改" title="取消修改（Esc）" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={cancel}><ResetIcon aria-hidden className="size-4" /></Button>
          <Button variant="ghost" size="xs" className="size-6 bg-primary/10 p-0 text-primary hover:bg-primary/15" aria-label="保存修改" title="保存修改（Ctrl／⌘+Enter）" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={commit}><CheckIcon aria-hidden className="size-4" /></Button>
          <Button variant="ghost" size="xs" className="size-6 p-0 text-muted-foreground" aria-label="放大编辑" title="放大编辑" onMouseDown={event => event.preventDefault()} onClick={expand}><EnterFullScreenIcon aria-hidden className="size-4" /></Button>
        </div>
      </div>
      {speech}
    </div>
    {support && <div className="shrink-0 pl-2">{support}</div>}
    <Dialog open={expanded} onOpenChange={open => { if (!open) collapse(); }}>
      {expanded && <DialogContent className="ag-custom-component-popup gap-3" aria-describedby="enlarged-editor-help" onKeyDown={event => event.stopPropagation()}
        onEscapeKeyDown={event => { event.preventDefault(); if (!event.isComposing) collapse(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          requestAnimationFrame(() => { focusInput(input.current); });
        }}>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="m-0 text-lg font-semibold">编辑{label === '文案' ? '口播文案' : label} · 片段 {data?.order}</DialogTitle>
          <Button variant="ghost" size="sm" aria-label="缩小编辑" onClick={collapse}><ExitFullScreenIcon aria-hidden />缩小</Button>
        </div>
        <textarea ref={enlargedInput} aria-label={`放大${label}全文`} className="m-0 block h-[min(48dvh,320px)] min-h-[100px] max-h-[calc(100dvh-180px)] w-full resize-none rounded-md border border-solid border-input bg-background p-3 font-[inherit] text-base leading-7 text-foreground" value={text} readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span id="enlarged-editor-help" className="mr-auto text-xs text-muted-foreground">Esc 缩小 · Ctrl／⌘+Enter 保存</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={cancel}>取消修改</Button>
          <Button size="sm" disabled={busy} onClick={commit}>保存修改</Button>
        </div>
      </DialogContent>}
    </Dialog>
  </div>;
}
