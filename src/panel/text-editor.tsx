import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { EnterFullScreenIcon, ExitFullScreenIcon } from '@radix-ui/react-icons';
import { Button, Dialog, DialogContent, DialogTitle } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';

/** 原位输入和放大视图共用表格草稿，切换尺寸不提交、不重新取得修改权。 */
export function TextEditor({ value, data, change, commit, cancel, busy }: { value: string; data: Segment; change: (value: string) => void; commit: (mode: 'advance' | 'stay') => void; cancel: (input: HTMLTextAreaElement | null) => void; busy: boolean }) {
  // AG Grid 的 renderer 参数异步刷新；输入立即回显，同时同步到共享草稿。
  const [text, setText] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const enlargedInput = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const helpId = useId();
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const selection = useRef({ start: 0, end: 0 });
  const initialized = useRef(false);
  useEffect(() => {
    if (busy || initialized.current || !input.current) return;
    initialized.current = true;
    const element = input.current;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
    element.scrollTop = element.scrollHeight;
  }, [busy]);
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
    if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || event.altKey)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) commit(event.ctrlKey || event.metaKey ? 'advance' : 'stay');
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(event.currentTarget); return; }
    if (event.key === 'Tab' || event.key === ' ') event.stopPropagation();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) event.stopPropagation();
  };
  const saveKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl↵';
  const actions = (element: typeof input) => <>
    <Button variant="ghost" size="sm" className="gap-0.5 px-1 text-xs text-muted-foreground max-[720px]:flex-auto max-[720px]:px-0 max-[480px]:gap-0 max-[480px]:text-[11px]" aria-label="取消修改" aria-keyshortcuts="Escape" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={() => cancel(element.current)}>取消 <kbd aria-hidden className="text-[10px] tracking-tight">Esc</kbd></Button>
    <Button variant="ghost" size="sm" className="gap-0.5 bg-primary/10 px-1 text-xs text-primary hover:bg-primary/15 max-[720px]:flex-auto max-[720px]:px-0 max-[480px]:gap-0 max-[480px]:text-[11px]" aria-label="保存修改" aria-keyshortcuts="Control+Enter Meta+Enter" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={() => commit('advance')}>保存 <kbd aria-hidden className="text-[10px] tracking-tight">{saveKey}</kbd></Button>
  </>;
  const help = <><span className="whitespace-nowrap">保存并编辑下一句 ·</span>{' '}<span className="whitespace-nowrap">Alt+↵ 仅保存</span></>;
  return <div onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !expandedRef.current) {
      event.preventDefault(); event.stopPropagation(); cancel(input.current);
    }
  }} className="flex h-full w-full min-w-0 flex-1 flex-col">
    <div data-inline-text-box className="relative flex min-h-0 flex-1 items-start gap-2 max-[720px]:flex-col max-[720px]:gap-0">
      <div className="h-full min-h-0 min-w-0 flex-1 max-[720px]:w-full max-[720px]:pr-8">
        <textarea className="m-0 block h-full min-h-0 w-full resize-none overflow-hidden rounded-md border border-solid border-input bg-background px-[3px] pt-[7px] font-[inherit] text-base text-foreground outline-none max-[720px]:pt-0" ref={input} aria-label="文案全文" aria-describedby={helpId} value={text}
          readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
      </div>
      <div role="group" aria-label="文案编辑操作" className="flex flex-none flex-col rounded-md bg-background max-[720px]:w-full">
        <div className="flex justify-end gap-1 max-[480px]:gap-px">
          {actions(input)}
          <Button variant="ghost" size="icon-sm" className="p-0 text-muted-foreground max-[720px]:absolute max-[720px]:top-0 max-[720px]:right-0 max-[720px]:h-7" aria-label="放大编辑" title="放大编辑" onMouseDown={event => event.preventDefault()} onClick={expand}><EnterFullScreenIcon aria-hidden /></Button>
        </div>
        <p id={helpId} className="m-0 text-[10px] leading-[11px] whitespace-normal text-muted-foreground">{help}</p>
      </div>
    </div>
    <Dialog open={expanded} onOpenChange={open => { if (!open) collapse(); }}>
      {expanded && <DialogContent className="ag-custom-component-popup gap-3" aria-describedby="enlarged-editor-help" onKeyDown={event => event.stopPropagation()}
        onEscapeKeyDown={event => { event.preventDefault(); if (!event.isComposing) cancel(enlargedInput.current); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          requestAnimationFrame(() => { focusInput(input.current); });
        }}>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="m-0 text-lg font-semibold">编辑口播文案 · 片段 {data?.order}</DialogTitle>
          <Button variant="ghost" size="sm" aria-label="缩小编辑" onClick={collapse}><ExitFullScreenIcon aria-hidden />缩小</Button>
        </div>
        <textarea ref={enlargedInput} aria-label="放大文案全文" className="m-0 block h-[min(48dvh,320px)] min-h-[100px] max-h-[calc(100dvh-180px)] w-full resize-none rounded-md border border-solid border-input bg-background p-3 font-[inherit] text-base text-foreground" value={text} readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span id="enlarged-editor-help" className="mr-auto text-xs text-muted-foreground">{help}</span>
          {actions(enlargedInput)}
        </div>
      </DialogContent>}
    </Dialog>
  </div>;
}
