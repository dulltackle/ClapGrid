/** 服务总清理预算：结合常见 5 秒请求、8 秒宿主核对和媒体既有 2 秒 TERM 升级；超预算保留现场。 */
export const SERVICE_CLEANUP_MS = 10_000;

/** 跨构建 adapter 通过结构字段传递释放结论，不依赖 instanceof。 */
export class ServiceCleanupError extends AggregateError {
  constructor(errors: unknown[], public readonly resourcesReleased: boolean, directory: string, phase: string) {
    super(errors, `${phase}：${errors.map(String).join('；')}；${resourcesReleased ? '资源已释放' : `资源未确认释放；保留目录 ${directory}`}`);
    this.name = 'ServiceCleanupError';
  }
}

/** 只限制等待，不把超时认作取消成功；迟到 Promise 的结果仍被消费。 */
export async function beforeServiceDeadline<T>(deadline: number, phase: string, action: () => T | Promise<T>): Promise<T> {
  if (Date.now() >= deadline) throw new Error(`${phase}超时，未确认释放`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase}超时，未确认释放`)), Math.max(1, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}
