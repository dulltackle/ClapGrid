import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** 原生模态层隔离背景交互；所有关闭请求仍由业务流程决定。 */
export function Dialog({ label, onClose, restoreFocus, children }: {
  label: string;
  onClose: () => void;
  restoreFocus: () => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  useLayoutEffect(() => {
    const dialog = element.current!;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      // 等待 React 更新触发入口的禁用状态；StrictMode 重挂载不恢复背景焦点。
      requestAnimationFrame(() => {
        if (dialog.isConnected) return;
        const remaining = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')];
        if (remaining.length) {
          if (!remaining.some(layer => layer.contains(document.activeElement))) remaining.at(-1)!.focus({ preventScroll: true });
        } else restore.current();
      });
    };
  }, []);
  useLayoutEffect(() => {
    const dialog = element.current!;
    if (!dialog.contains(document.activeElement) || document.activeElement?.matches(':disabled')) {
      dialog.focus({ preventScroll: true });
    }
  });
  const focusEdge = (last = false) => {
    const dialog = element.current!;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], audio[controls], video[controls], [tabindex]')]
      .filter(node => !node.hasAttribute('data-focus-guard') && !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length > 0);
    (last ? controls.at(-1) : controls[0])?.focus({ preventScroll: true });
    if (!controls.length) dialog.focus({ preventScroll: true });
  };
  return <dialog ref={element} aria-label={label} className="media-dialog" tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key === 'Tab' && document.activeElement === element.current) {
        event.preventDefault(); focusEdge(event.shiftKey);
      }
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <span tabIndex={0} data-focus-guard aria-hidden="true" onFocus={() => focusEdge(true)} />
    {children}
    <span tabIndex={0} data-focus-guard aria-hidden="true" onFocus={() => focusEdge()} />
  </dialog>;
}
