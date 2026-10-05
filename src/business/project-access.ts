import { randomUUID } from 'node:crypto';

type Editor = 'user' | 'codex';
type Task = 'speech' | 'export';
type Operation = 'edit' | Task | 'speech-batch' | 'speech-replay' | 'current-speech';
type Occupation = { kind: 'edit'; owner: Editor; token: string; controller: AbortController; pending: number; verify?: () => Promise<void> } | { kind: Task };

/** 项目内唯一的占用记录；任务自行确认保存、清理完成后才释放。 */
export function projectAccess() {
  let current: Occupation | null = null;
  const speechMessage = '配音进行中，项目已锁定；允许查询和试听';
  const exportMessage = '导出进行中，项目已锁定；可查询、试听和取消导出';
  const rejection = (operation: Operation): string | undefined => {
    // 重放和读取已有配音各有允许范围，不能套用新任务的准入规则。
    if (operation === 'speech-replay') return current?.kind === 'export' ? exportMessage : undefined;
    if (operation === 'current-speech') return current?.kind === 'speech' ? speechMessage : undefined;
    if (current?.kind === 'export') return exportMessage;
    if (current?.kind === 'speech') {
      if (operation === 'export') return '配音任务尚未结束，不能开始导出；允许查询和试听';
      return operation === 'speech-batch' ? '配音进行中，不能追加生成' : speechMessage;
    }
    if (current?.kind === 'edit') {
      if (operation === 'speech' || operation === 'speech-batch') return '项目正在修改';
      return current.owner === 'user' ? '用户正在编辑' : 'Codex 正在修改';
    }
  };
  const assertAllowed = (operation: Operation) => {
    const message = rejection(operation);
    if (message) throw new Error(message);
  };
  const owns = (token: string, owner?: Editor) => current?.kind === 'edit' && current.token === token && !current.controller.signal.aborted && (!owner || current.owner === owner);
  return {
    rejection,
    assertAllowed,
    getActivity() {
      return {
        modification: current?.kind === 'edit' ? { owner: current.owner } : null,
        task: current?.kind === 'speech' || current?.kind === 'export' ? current.kind : null,
      };
    },
    acquire(owner: Editor, verify?: () => Promise<void>) {
      assertAllowed('edit');
      const token = randomUUID();
      current = { kind: 'edit', owner, token, controller: new AbortController(), pending: 0, verify };
      return token;
    },
    owns,
    editSignal(token: string, message = '修改权已失效'): AbortSignal {
      if (current?.kind !== 'edit' || current.token !== token || current.controller.signal.aborted) throw new Error(message);
      return current.controller.signal;
    },
    async verifyEdit(token: string) {
      if (current?.kind !== 'edit' || !owns(token)) throw new Error('修改权已失效');
      await current.verify?.();
      if (!owns(token)) throw new Error('修改权已失效');
    },
    retainEdit(token: string) {
      if (current?.kind !== 'edit' || !owns(token)) throw new Error('修改权已失效');
      const occupation = current; occupation.pending++; let completed = false;
      return () => {
        if (completed) return; completed = true; occupation.pending--;
        if (current === occupation && occupation.controller.signal.aborted && !occupation.pending) current = null;
      };
    },
    assertWritable(token?: string) {
      if (current?.kind === 'speech' || current?.kind === 'export') assertAllowed('edit');
      if ((current?.kind === 'edit' && current.token !== token) || (token && !owns(token))) throw new Error('未持有有效修改权');
    },
    release(token: string) {
      // 迟到的连接事件只能释放自己的普通修改权，不能解除任务占用。
      if (current?.kind === 'edit' && current.token === token) {
        const previous = current;
        previous.controller.abort();
        // 撤销停止后续提交；媒体退出及临时文件清理前仍保留项目占用。
        if (!previous.pending) current = null;
      }
    },
    beginTask(kind: Task) {
      assertAllowed(kind);
      const occupation: Occupation = { kind };
      current = occupation;
      // 释放属于这一次任务；重复或迟到的释放不会影响后续编辑或任务。
      return () => { if (current === occupation) current = null; };
    },
  };
}

export type ProjectAccess = ReturnType<typeof projectAccess>;
