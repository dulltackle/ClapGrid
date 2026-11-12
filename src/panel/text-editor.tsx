import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EnterFullScreenIcon, ExitFullScreenIcon } from '@radix-ui/react-icons';
import { Button, Dialog, DialogContent, DialogTitle } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';

/** 原位输入和放大视图共用表格草稿，切换尺寸不提交、不重新取得修改权。 */
export function TextEditor({ value, data, change, commit, cancel, busy, onVisibilityChange }: {
  value: string; data: Segment; change: (value: string) => void; commit: (mode: 'advance' | 'stay') => void;
  cancel: (input: HTMLTextAreaElement | null) => void; busy: boolean; onVisibilityChange: (visible: boolean) => void;
}) {
  // AG Grid 的 renderer 参数异步刷新；输入立即回显，同时同步到共享草稿。
  const [text, setText] = useState(value);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const enlargedInput = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const helpId = useId();
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const selection = useRef({ start: 0, end: 0 });
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const editor = box.current;
    const textarea = input.current;
    const viewport = editor?.closest<HTMLElement>('.ag-grid-viewport');
    if (!editor || !textarea || !viewport) return;
    const headerHeight = viewport.querySelector('.ag-header')?.getBoundingClientRect().height ?? 0;
    // 让能放进表格的草稿完整展开，超出表格时只滚动输入区。
    const fit = () => editor.style.setProperty('--inline-editor-height', `${viewport.clientHeight - headerHeight}px`);
    const resize = new ResizeObserver(fit);
    fit();
    resize.observe(viewport);
    // 固定表头可能遮住全部草稿文字，此时即使底栏可见也需要恢复入口。
    const observer = new IntersectionObserver(([entry]) => onVisibilityChange(!!entry?.isIntersecting), {
      root: viewport, rootMargin: `-${headerHeight}px 0px 0px`,
    });
    observer.observe(textarea);
    return () => { resize.disconnect(); observer.disconnect(); onVisibilityChange(false); };
  }, [onVisibilityChange]);
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
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const actions = (element: typeof input) => <>
    <Button variant="ghost" size="sm" className="gap-1 px-1.5 text-xs" aria-label="取消修改" aria-keyshortcuts="Escape" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={() => cancel(element.current)}>取消 <kbd aria-hidden className="text-[11px] opacity-70">Esc</kbd></Button>
    <Button size="sm" className="gap-1 px-1.5 text-xs" aria-label="保存修改" aria-keyshortcuts="Control+Enter Meta+Enter" onMouseDown={event => event.preventDefault()} disabled={busy} onClick={() => commit('advance')}>保存 <kbd aria-hidden className="text-[11px] opacity-70">{modifier}↵</kbd></Button>
  </>;
  const help = <>{modifier}+↵ 保存并编辑下一句 · <span className="whitespace-nowrap">Alt+↵ 仅保存</span></>;
  return <div onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !expandedRef.current) {
      event.preventDefault(); event.stopPropagation(); cancel(input.current);
    }
  }}>
    <div ref={box} data-inline-text-box className="flex max-h-[calc(var(--inline-editor-height,100dvh)_-_var(--space-2))] w-full flex-col gap-1.5 rounded-md border border-solid border-input bg-background p-1.5 focus-within:border-focus">
      <textarea className="m-0 block min-h-[1lh] w-full resize-none overflow-x-hidden overflow-y-auto border-0 bg-transparent p-0 font-[inherit] text-base text-foreground outline-none [field-sizing:content]" ref={input} rows={1} aria-label="文案全文" aria-describedby={helpId} value={text}
        readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
      <div role="group" aria-label="文案编辑操作" className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        <p id={helpId} className="m-0 min-w-0 flex-[1_1_108px] text-xs leading-tight whitespace-normal text-muted-foreground">{help}</p>
        <div className="flex max-w-full flex-wrap justify-end gap-1">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="放大编辑" title="放大编辑" onMouseDown={event => event.preventDefault()} onClick={expand}><EnterFullScreenIcon aria-hidden /></Button>
          {actions(input)}
        </div>
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
