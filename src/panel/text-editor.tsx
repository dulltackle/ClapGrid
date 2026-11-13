import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export type TextCommit = 'advance' | 'stay' | 'down' | 'right' | 'left';

export function TextEditor({ value, change, commit, discard, busy, onVisibilityChange }: {
  value: string; change: (value: string) => void; commit: (mode: TextCommit) => void;
  discard: () => void; busy: boolean; onVisibilityChange: (visible: boolean) => void;
}) {
  // AG Grid 的 renderer 参数异步刷新；输入立即回显，同时同步到共享草稿。
  const [text, setText] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const textarea = input.current;
    const editor = textarea?.parentElement;
    const viewport = editor?.closest<HTMLElement>('.ag-grid-viewport');
    if (!editor || !textarea || !viewport) return;
    const headerHeight = viewport.querySelector('.ag-header')?.getBoundingClientRect().height ?? 0;
    // 让能放进表格的草稿完整展开，超出表格时只滚动输入区。
    const fit = () => editor.style.setProperty('--inline-editor-height', `${viewport.clientHeight - headerHeight}px`);
    const resize = new ResizeObserver(fit);
    fit();
    resize.observe(viewport);
    // 固定表头遮住草稿时，通过页脚恢复编辑位置。
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
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || event.altKey)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) commit(event.ctrlKey || event.metaKey ? 'advance' : 'stay');
      return;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) commit(event.key === 'Enter' ? 'down' : event.shiftKey ? 'left' : 'right');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      discard();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.stopPropagation();
  };
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  return <>
    <textarea className="m-0 block min-h-[1lh] w-full resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap wrap-anywhere border-0 bg-transparent p-0 font-[inherit] text-base text-foreground outline-none [field-sizing:content]" ref={input} rows={1} aria-label="文案全文" aria-describedby={helpId} value={text}
      readOnly={busy} onChange={event => { setText(event.target.value); change(event.target.value); }} onKeyDownCapture={keys} />
    <p id={helpId} className="sr-only">Enter 保存并移到下一行，Tab 保存并移到相邻单元格，Shift+Enter 换行，Esc 撤销。{modifier}+↵ 保存并编辑下一句 · Alt+↵ 仅保存</p>
  </>;
}
