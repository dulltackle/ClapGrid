/** @license
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

/** 关闭请求由业务决定；容器是初始及动态禁用后的焦点后备。 */
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const element = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const content = element.current;
    const layers = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].filter(layer => layer.dataset.state !== 'closed');
    // 嵌套 Portal 不在父容器内；只有最上层负责动态禁用的后备焦点。
    if (content && layers.at(-1) === content && (!content.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) {
      content.focus({ preventScroll: true });
    }
  });
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" onPointerDown={event => event.preventDefault()} />
    <DialogPrimitive.Content {...props} ref={element} aria-modal="true"
      className={cn('fixed top-[50%] left-[50%] z-50 flex flex-col w-[680px] max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-solid border-[var(--color-border)] bg-background text-foreground p-6 shadow-lg', className)}
      onOpenAutoFocus={event => { event.preventDefault(); element.current?.focus({ preventScroll: true }); }}
      onPointerDownOutside={event => event.preventDefault()}>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}
