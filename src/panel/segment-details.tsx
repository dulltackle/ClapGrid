import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Textarea, AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/index.js';
import type { Segment, ServiceStatus } from '../shared/contracts.js';
import type { ProjectEditing } from './project-editing.js';

export type SegmentIntent = { id: string; inline?: boolean; focusText?: boolean } | null;

/** 详情草稿持有现有编辑租约；导航意图按稳定身份保存，提交成功后才继续。 */
export function useSegmentDetails({ editing, status, accept, save, failed, inline, stopInline, restore }: {
  editing: ProjectEditing; status: ServiceStatus | undefined; accept: (status: ServiceStatus) => void;
  save: (id: string, text: string) => Promise<boolean>; failed: (error: Error) => void;
  inline: (id: string) => Promise<void>; stopInline: () => void; restore: () => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; base: string; text: string } | null>(null);
  const [focusRequest, setFocusRequest] = useState<'text' | 'panel' | null>(null);
  const [pending, setPending] = useState<{ intent: SegmentIntent } | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const sequence = useRef(0);
  const current = useRef(status); current.current = status;
  const dirty = !!draft && draft.text !== draft.base;
  const idle = () => new Promise<void>(resolve => {
    const check = () => { const state = editing.getState(); if (!state.busy && !state.editing) { unsubscribe(); resolve(); } };
    const unsubscribe = editing.subscribe(check); check();
  });
  const execute = async (intent: SegmentIntent) => {
    const version = ++sequence.current;
    if (draft) { await editing.cancel('segments'); setDraft(null); }
    else { stopInline(); await idle(); }
    if (version !== sequence.current) return;
    if (!intent) { setId(null); requestAnimationFrame(() => { if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) restore(); }); return; }
    if (!current.current?.snapshot.segments.some(segment => segment.id === intent.id)) { failed(new Error('口播片段已删除，请选择其他片段。')); return; }
    if (!intent.inline || id) setId(intent.id);
    if (intent.inline) await inline(intent.id);
    else setFocusRequest(intent.focusText ? 'text' : 'panel');
  };
  const navigate = (intent: SegmentIntent) => {
    if (editing.getState().busy && (draft || !intent?.inline)) return;
    if (dirty) { setPending({ intent }); return; }
    void execute(intent);
  };
  const begin = () => {
    if (!id || draft || editing.getState().editing || editing.getState().busy) return;
    const requested = sequence.current;
    const origin = text.current;
    let acquired = false;
    const stillRequested = () => requested === sequence.current && (document.activeElement === origin || document.activeElement === panel.current);
    void editing.begin('segments', next => {
      if (!stillRequested()) { void editing.cancel('segments'); return; }
      const segment = next.snapshot.segments.find(item => item.id === id);
      if (!segment) throw new Error('口播片段已删除，请选择其他片段。');
      accept(next); acquired = true; setDraft({ id, base: segment.text, text: segment.text });
    }, () => failed(new Error('编辑连接已断开，详情草稿已保留；请重新保存或放弃。')), failed).then(() => { if (acquired) requestAnimationFrame(() => { if (stillRequested()) text.current?.focus({ preventScroll: true }); }); });
  };
  const commit = async () => {
    if (!draft) return true;
    if (!editing.getState().editing) {
      let acquired = false;
      await editing.begin('segments', next => {
        const current = next.snapshot.segments.find(segment => segment.id === draft.id);
        if (!current) throw new Error('口播片段已删除，草稿仍保留，请复制后关闭。');
        if (current.text !== draft.base) throw new Error('文案已被其他操作修改，草稿仍保留；请核对后放弃或复制，不能覆盖新内容。');
        accept(next); acquired = true;
      }, () => failed(new Error('编辑连接已断开，详情草稿已保留；请重新保存或放弃。')), failed);
      if (!acquired) return false;
    }
    const success = await save(draft.id, draft.text);
    if (success) setDraft(null);
    return success;
  };
  return { id, draft, dirty, pending, text, panel, navigate, begin, focusRequest, consumeFocus: () => setFocusRequest(null),
    change: (value: string) => setDraft(previous => previous && ({ ...previous, text: value })),
    commit,
    continueEditing: () => { setPending(null); requestAnimationFrame(() => text.current?.focus()); },
    discard: async () => { const intent = pending?.intent ?? null; setPending(null); await execute(intent); },
    saveAndContinue: async () => { const intent = pending?.intent ?? null; if (await commit()) { setPending(null); await execute(intent); } },
  };
}

type Controller = ReturnType<typeof useSegmentDetails>;
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
      const target = request === 'text' ? controller.text.current : controller.panel.current;
      if (target && !target.matches(':disabled')) { controller.consumeFocus(); target.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [controller.focusRequest, busy, disabled]);
  const index = segments.findIndex(item => item.id === controller.id);
  const go = (offset: number) => { const next = segments[index + offset]; if (next) controller.navigate({ id: next.id }); };
  return <>
    <aside ref={controller.panel} tabIndex={-1} onFocusCapture={event => { focusedControl.current = event.target as HTMLElement; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedControl.current = null; }} aria-label="口播片段详情" onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && !controller.pending) { event.preventDefault(); controller.navigate(null); }
    }} className={`absolute right-0 top-12 bottom-0 z-20 flex w-[450px] max-w-full flex-col gap-5 overflow-y-auto border-l border-solid border-input bg-background p-5 shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0 ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex shrink-0 items-center justify-between gap-2"><h2 className="m-0 text-lg font-semibold">{segment ? `片段 ${segment.order}` : '片段已删除'}</h2><div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label="上一条片段" title="上一条" disabled={busy || index <= 0} onClick={() => go(-1)}>↑</Button>
        <Button variant="ghost" size="sm" aria-label="下一条片段" title="下一条" disabled={busy || index < 0 || index >= segments.length - 1} onClick={() => go(1)}>↓</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => controller.navigate(null)}>关闭详情</Button>
      </div></div>
      {(segment || controller.draft) && <>
        {segment && <section className="space-y-2" aria-label="详情画面素材"><h3 className="m-0 font-medium">画面素材</h3>{media}</section>}
        <section className="space-y-2"><label htmlFor="segment-draft" className="font-medium">文案</label>
          <Textarea id="segment-draft" aria-label="详情文案" ref={controller.text} value={controller.draft?.text ?? segment?.text ?? ''}
            disabled={busy || (!controller.draft && disabled)} readOnly={!controller.draft || !segment}
            onFocus={controller.begin} onChange={event => controller.change(event.target.value)} />
          {controller.draft && <Button size="sm" disabled={busy || !segment} onClick={() => { void controller.commit(); }}>保存文案</Button>}
        </section>
        {!segment && <p role="status" className="m-0 text-muted-foreground">片段已删除，未保存文案仍可选中复制；无法保存到已删除片段。</p>}
        {segment && children}
      </>}
      {error && <p className="m-0 text-destructive" role="alert">{error}</p>}
    </aside>
    {controller.pending && <AlertDialog open onOpenChange={open => { if (!open && !busy) controller.continueEditing(); }}>
      <AlertDialogContent onCloseAutoFocus={event => event.preventDefault()}>
        <AlertDialogTitle>保存未提交的文案？</AlertDialogTitle>
        <AlertDialogDescription>保存后继续原操作，或放弃这次修改。</AlertDialogDescription>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" data-continue-editing disabled={busy} onClick={controller.continueEditing}>继续编辑</Button>
          <Button variant="outline" data-discard-draft disabled={busy} onClick={() => { void controller.discard(); }}>放弃修改</Button>
          <Button disabled={busy} onClick={() => { void controller.saveAndContinue(); }}>保存并继续</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>}
  </>;
}
