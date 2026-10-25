# Vitest 项目资源 fixture

从 `tests/helpers/resource-test.ts` 导入 `test`，在测试参数中声明实际需要的工厂；没有请求项目资源的测试不会创建资源协调者。

```ts
import { test } from './helpers/resource-test.js';

test('通过真实服务读取项目', async ({ createDirectory, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-example-'));
  const service = await startService({ projectDirectory: root, panelDirectory, port: 0 });
  const table = await openConnection(() => connectTable(service.url));
  // 使用真实 HTTP/SQLite 与连接执行断言。
});
```

## 使用规则

- `createDirectory` 只用于本例创建的目录，不要返回本例未创建的目录。
- 连接在 `openConnection` 的工厂内创建；CLI 启动的服务用 `ownService` 交出关闭入口，本例启动的进程用 `ownProcess` 保存出生身份。
- 命令函数（`command`、`execCommand`、`execText`、`execBytes`）由 fixture 返回并绑定本例；辅助函数显式接收它们，不从模块导入全局命令包装器。测试体中遗留的异步链持有原测试信号，不能借用清理预算。
- 各 fixture 不单独 teardown，由按例协调者统一清理。
- Vitest 的 fixture teardown 早于 `onTestFinished`。阻止服务退出的测试阻塞门、HTTP 请求和故障 SQLite 连接应由连接 fixture 拥有，在连接阶段解除；仅记录最终观测、恢复环境变量或释放外层故障现场的原生钩子可以保留。

回归入口是 `bounded-run`、`service-cleanup`、`command-exit`、`service-exit-wait` 专项，以及全套 Vitest 和类型检查。
