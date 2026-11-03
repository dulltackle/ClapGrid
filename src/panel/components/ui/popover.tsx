import { useRef, type ComponentProps } from 'react';
import { Popover as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils.js';

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;

/** 悬浮内容通过 Portal 脱离表格裁切，嵌套原件预览时保留其来源。 */
export function PopoverContent({ className, children, ...props }: ComponentProps<typeof Primitive.Content>) {
  const content = useRef<HTMLDivElement>(null);
  return <Primitive.Portal><Primitive.Content ref={content} align="start" sideOffset={6} collisionPadding={12} className={cn('z-40 max-h-[var(--radix-popover-content-available-height)] w-[min(620px,calc(100vw-24px))] overflow-auto rounded-lg border border-solid border-input bg-popover p-3 text-popover-foreground shadow-lg', className)} onInteractOutside={event => {
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(dialog => dialog !== content.current && dialog.getAttribute('data-state') !== 'closed')) event.preventDefault();
  }} {...props}>{children}</Primitive.Content></Primitive.Portal>;
}
