import { useEffect, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/index.js';

/** 删除目标由调用方冻结；原语负责通用焦点约束，业务负责稳定行恢复。 */
export function DeleteConfirm({ count, disabled, lock, onClose, onConfirm, restoreFocus }: {
  count: number; disabled: boolean; lock: string; onClose: () => void;
  onConfirm: () => void; restoreFocus: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 旧版 Chrome 设置 disabled 时先把焦点移到 body，effect 中不能只检查确认按钮。
    const active = document.activeElement;
    if (disabled && (active === confirm.current || active === document.body)) cancel.current?.focus({ preventScroll: true });
  }, [disabled]);
  return <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}>
    <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle>删除口播片段</AlertDialogTitle>
        <AlertDialogDescription>{count === 1 ? '确定删除这个口播片段？' : `确定删除已勾选的 ${count} 个口播片段？`}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel ref={cancel}>取消</AlertDialogCancel>
        <AlertDialogAction ref={confirm} variant="destructive" data-delete-confirm disabled={disabled} onClick={event => { event.preventDefault(); onConfirm(); }}>删除</AlertDialogAction>
      </AlertDialogFooter>
      {lock && <p className="m-0" role="status">{lock}</p>}
    </AlertDialogContent>
  </AlertDialog>;
}
