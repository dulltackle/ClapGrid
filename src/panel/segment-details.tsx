import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Textarea, AlertDialog, AlertDialogContent, AlertDialogCancel, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/index.js';
import type { Segment } from '../shared/contracts.js';
import type { useSegmentInteraction } from './segment-interaction.js';

export type { SegmentTextField } from './segment-navigation.js';

type Controller = ReturnType<typeof useSegmentInteraction>;
export function SegmentDetails({ controller, segment, segments, busy, disabled, children, media, error }: {
  controller: Controller; segment: Segment | undefined; segments: Segment[]; busy: boolean; disabled: boolean;
  children: ReactNode; media: ReactNode; error: string;
}) {
  const [visible, setVisible] = useState(false);
  const focusedControl = useRef<HTMLElement | null>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    const active = document.activeElement;
    if ((disabled || busy) && !document.querySelector('[aria-modal="true"]') && ((active === document.body && focusedControl.current?.matches(':disabled')) || (active instanceof HTMLElement && controller.panel.current?.contains(active) && active.matches(':disabled')))) controller.panel.current?.focus({ preventScroll: true });
  }, [disabled, busy]);
  useEffect(() => {
    if (!controller.focusRequest || busy) return;
    const request = controller.focusRequest;
    const frame = requestAnimationFrame(() => {
      if (!request.intent.valid()) { controller.consumeFocus(); return; }
      const target = request.target === 'text' ? controller.text.current : request.target === 'visualNote' ? controller.visualNote.current : controller.panel.current;
      if (target && !target.matches(':disabled')) { controller.consumeFocus(); target.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [controller.focusRequest, busy, disabled]);
  // 点击进入忙态前补记实际焦点，避免控件禁用失焦后丢失后备身份。
  const rememberClickedFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && controller.panel.current?.contains(active)) focusedControl.current = active;
  };
  const index = segments.findIndex(item => item.id === controller.id);
  const go = (offset: number) => { const next = segments[index + offset]; if (next) controller.navigate({ id: next.id }); };
  return <>
    <aside ref={controller.panel} tabIndex={-1} onFocusCapture={event => { focusedControl.current = event.target as HTMLElement; }} onClickCapture={rememberClickedFocus} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedControl.current = null; }} aria-label="口播片段详情" onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && !controller.pending) { event.preventDefault(); event.stopPropagation(); controller.escape(); }
    }} className={`absolute right-0 top-12 bottom-0 z-20 flex w-[450px] max-w-full flex-col gap-5 overflow-y-auto border-l border-solid border-input bg-background p-5 shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0 ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex shrink-0 items-center justify-between gap-2"><h2 className="m-0 text-lg font-semibold">{segment ? `片段 ${segment.order}` : '片段已删除'}</h2><div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label="上一条片段" title="上一条" disabled={index <= 0} onClick={() => go(-1)}>↑</Button>
        <Button variant="ghost" size="sm" aria-label="下一条片段" title="下一条" disabled={index < 0 || index >= segments.length - 1} onClick={() => go(1)}>↓</Button>
        <Button variant="ghost" size="sm" onClick={() => controller.navigate(null)}>关闭详情</Button>
      </div></div>
      {(segment || controller.draft) && <>
        {segment && <section className="space-y-2" aria-label="详情画面素材"><h3 className="m-0 font-medium">画面素材</h3>{media}</section>}
        <section className="space-y-2"><label htmlFor="segment-draft" className="font-medium">文案</label>
          <Textarea id="segment-draft" aria-label="详情文案" ref={controller.text} value={controller.draft?.text ?? segment?.text ?? ''}
            readOnly={busy || !controller.draft || !segment}
            onDoubleClick={() => controller.begin('text')} onKeyDown={event => { if (event.nativeEvent.isComposing) { event.stopPropagation(); return; } if (!controller.draft && ['Enter', 'F2'].includes(event.key)) { event.preventDefault(); controller.begin('text'); } if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void controller.commit(); } }} onChange={event => controller.change(event.target.value)} />
        </section>
        <section className="space-y-2"><label htmlFor="segment-visual-note" className="font-medium">画面说明</label>
          <Textarea id="segment-visual-note" aria-label="详情画面说明" ref={controller.visualNote} value={controller.draft?.visualNote ?? segment?.visualNote ?? ''}
            readOnly={busy || !controller.draft || !segment}
            onDoubleClick={() => controller.begin('visualNote')} onKeyDown={event => { if (event.nativeEvent.isComposing) { event.stopPropagation(); return; } if (!controller.draft && ['Enter', 'F2'].includes(event.key)) { event.preventDefault(); controller.begin('visualNote'); } if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void controller.commit(); } }} onChange={event => controller.change(event.target.value, 'visualNote')} />
          <p className="m-0 text-xs text-muted-foreground">可选，供你和 Codex 参考；保存说明不直接改变制作结果。</p>
        </section>
        {!controller.draft && <Button size="sm" disabled={disabled} onClick={() => controller.begin()}>编辑片段</Button>}
        {controller.draft && <Button size="sm" disabled={busy || !segment} onClick={() => { void controller.commit(); }}>{controller.draft.visualNote !== controller.draft.baseVisualNote ? (controller.draft.text !== controller.draft.base ? '保存片段' : '保存画面说明') : '保存文案'}</Button>}
        {!segment && <p role="status" className="m-0 text-muted-foreground">片段已删除，未保存内容仍可选中复制；无法保存到已删除片段。</p>}
        {segment && children}
      </>}
      {error && <p className="m-0 text-destructive" role="alert">{error}</p>}
    </aside>

  </>;
}

/** 放弃提示同时服务原位和详情，Esc 只关闭这一层。 */
export function SegmentDraftPrompt({ controller, busy }: { controller: Controller; busy: boolean }) {
  return <AlertDialog open={controller.pending} onOpenChange={open => { if (!open && !busy) controller.continueEditing(); }}>
    <AlertDialogContent onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!event.isComposing && !busy) controller.continueEditing(); }}>
      <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
      <AlertDialogDescription>放弃后恢复已保存内容，或继续编辑保留草稿。</AlertDialogDescription>
      <div className="flex flex-wrap justify-end gap-2">
        <AlertDialogCancel disabled={busy} onClick={controller.continueEditing}>继续编辑</AlertDialogCancel>
        <Button disabled={busy} onClick={() => { void controller.discard(); }}>放弃修改</Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
