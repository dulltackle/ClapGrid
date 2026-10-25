// 验收通过进程组停止；媒体守护进程仍由 useProject → service.close 的 IPC 流程释放。
// 避免组信号抢先杀死它，导致正常停止被判定为资源释放未知。
if (/[/\\]media-worker\.(ts|js)$/.test(process.argv[1] ?? '')) {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
}
