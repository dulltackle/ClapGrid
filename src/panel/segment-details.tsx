import { Button, AlertDialog, AlertDialogContent, AlertDialogCancel, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/index.js';
import type { useSegmentInteraction } from './segment-interaction.js';
type Controller = ReturnType<typeof useSegmentInteraction>;

/** 放弃提示保留文案草稿，Esc 只关闭这一层。 */
export function SegmentDraftPrompt({ controller, busy }: { controller: Controller; busy: boolean }) {
  return <AlertDialog open={controller.pending} onOpenChange={open => { if (!open && !busy) controller.continueEditing(); }}>
    <AlertDialogContent onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!event.isComposing && !busy) controller.continueEditing(); }}>
      <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
      <AlertDialogDescription>放弃后恢复已保存内容，或继续编辑保留草稿。</AlertDialogDescription>
      <div className="flex flex-wrap justify-end gap-2">
        <AlertDialogCancel disabled={busy} onClick={controller.continueEditing}>继续编辑</AlertDialogCancel>
        <Button variant="outline" disabled={busy} onClick={() => { void controller.discard(); }}>放弃修改</Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
