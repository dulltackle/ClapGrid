import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** 行菜单使用固定视口坐标；业务入口共享关闭、焦点与键盘导航。 */
export function RowMenu({ x, y, onClose, children }: { x: number; y: number; onClose: (restore?: boolean) => void; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const focusedItem = useRef<HTMLElement | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const node = element.current!;
    const position = () => {
      const bounds = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    };
    position();
    (node.querySelector<HTMLElement>('button:not(:disabled)') ?? node).focus();
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) close.current(false); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', position);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', position); };
  }, [x, y]);
  useLayoutEffect(() => {
    const node = element.current;
    // 部分浏览器在禁用按钮时先将焦点移到 body，保留原焦点来源以恢复菜单。
    if (node && (document.activeElement === node || (document.activeElement === document.body && focusedItem.current?.matches(':disabled')) || (node.contains(document.activeElement) && document.activeElement?.matches(':disabled')))) {
      (node.querySelector<HTMLElement>('button:not(:disabled)') ?? node).focus();
    }
  });
  return <div ref={element} role="menu" aria-label="口播片段操作" className="row-menu" tabIndex={-1}
    onFocus={event => { focusedItem.current = event.target; }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onClose(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }}>{children}</div>;
}
