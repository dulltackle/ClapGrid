# Vitest 项目资源 fixture

从 `tests/helpers/resource-test.ts` 导入 `test`，在测试参数中声明实际需要的工厂。Vitest 按例、按依赖创建 fixture；没有请求项目资源的测试不会创建资源协调者。

```ts
import { test } from './helpers/resource-test.js';

test('通过真实服务读取项目', async ({ createDirectory, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-example-'));
  const service = await startService({ projectDirectory: root, panelDirectory, port: 0 });
  const table = await openConnection(() => connectTable(service.url));
  // 使用真实 HTTP/SQLite 与连接执行断言。
});
```

- `createDirectory(prefix)` 创建并拥有临时目录；特殊故障场景可以传入创建目录并返回路径的函数。不要返回本例未创建的目录。
- `openBusiness(...)`、`startService(...)` 按产品接口创建并拥有业务与服务；重开时再次调用，之前的实例也继续受清理保护。
- `openConnection(() => resource)` 在工厂内创建连接，支持异步连接；`connectMcp(client, transport)` 建立并拥有 stdio MCP 连接及其出生身份。
- `ownService(() => ({ close }))` 拥有通过 CLI 启动的具体服务关闭入口；`ownProcess(() => identity)` 保存本例启动进程的出生身份。身份识别与退出操作继续使用原有产品进程 helper。
- `command`、`execCommand`、`execText`、`execBytes` 由 fixture 返回本例绑定的命令函数。辅助函数显式接收它们，不从模块导入全局命令包装器。

所有工厂共享一个按例协调者；各 fixture 不单独 teardown。协调者在 `use()` 返回后，先关闭连接，再并行关闭业务与服务，再兜底终止拥有出生身份的进程和命令，全部确认后才删除目录。任一资源失败仍独立尝试其余资源，并汇总错误及保留目录路径。总预算保持 8 秒，连接阶段最多 2 秒，业务／服务阶段为后续兜底预留 2 秒。迟到的服务和连接仍会关闭。

命令函数在测试体中使用该测试的中止信号；协调者调用关闭入口时使用独立的清理信号。测试体中遗留的异步链仍持有原测试信号，不能借用清理预算。

Vitest 的 fixture teardown 早于 `onTestFinished`。阻止服务退出的测试阻塞门、HTTP 请求和故障 SQLite 连接应由连接 fixture 拥有，在连接阶段解除。仅记录最终观测、恢复环境变量或释放故障测试外层现场的原生钩子可以保留。

回归入口是 `bounded-run`、`service-cleanup`、`command-exit`、`service-exit-wait` 专项，以及全套 Vitest 和类型检查。
