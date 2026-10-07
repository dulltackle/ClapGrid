import { useEffect, useRef, type ComponentProps } from 'react';
import { ContextMenuContent } from '@/components/ui/index.js';

/** 动态业务锁禁用当前项时保留退出入口；导航、定位与浮层由原语负责。 */
export function RowMenu(props: ComponentProps<typeof ContextMenuContent>) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (node?.contains(document.activeElement) && document.activeElement?.getAttribute('aria-disabled') === 'true') {
      (node.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? node).focus({ preventScroll: true });
    }
  });
  return <ContextMenuContent ref={element} aria-label="口播片段操作" loop collisionPadding={8} {...props} />;
}
