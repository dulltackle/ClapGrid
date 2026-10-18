# 逻辑与真实服务的 Vitest 扩展（#164）

从 `2a5bcc4` 的清单中，新增迁移 14 个普通逻辑、SQLite、HTTP/MCP 和宿主心跳文件改为 Vitest 原生收集与执行，业务输入输出、真实服务、媒体与文件边界保持。加上首轮四文件共 18 个。唯一执行者清单同时驱动 `vitest.config.ts` 的 include，避免维护第二份固定文件列表；原 all 归属保留，按场景补入 logic/service。没有改变产品源码、重试或超时。

[逐场景映射](scenario-map.json) 将历史 67 条记录对应为 66 个实际测试和一个 describe 容器。旧“两个编码与全部支持帧率”父测试没有独立业务断言，只顺序 await 十个动态子测试；现以原生 describe 注册同样的两种编码 × 五种帧率，每个子例仍真实调用 1080p MP4 编码解码。其余场景同文件同名称，不能只用数量变化判断覆盖。原历史映射与报告保留，不改写为本轮通过。

## 生命周期与隔离

锁定 Vitest 5.0.5 的 `onTestFinished` 使用 stack 顺序并等待 Promise：先登记目录清理，创建业务/服务/连接后登记关闭，退出时逆序完成关闭后再删除目录。显式 `business.close()` 改为 await 后才重开数据库。业务重开、画面说明旧 SQLite 建立和 MCP 建连提前失败也有已登记清理；宿主环境变量在修改时立即登记恢复，启动失败不会污染后续场景。原 Node hooks 顺序不作为迁移后的隐式假设。

HTTP 继续使用端口 0，每例独立目录、SQLite、服务及 MCP transport。PATH、FONTCONFIG_FILE、CLAPGRID_CODEX_BIN 的修改继续在本例恢复。Vitest 保持一个 threads worker、`fileParallelism:false`、`isolate:true`，不在本票未经证明地开启跨文件并行；环境修改场景仍串行。原真实等待和媒体工具仍执行，没有把所有定时器改成 fake timers。

[本批保留的 Node 清单](retained-node.json) 逐文件记录进程、旧归档/证据独立验证、宿主和媒体边界。尤其导出专项的选择性 Node mock.timers 继续保留，不能用覆盖全部计时器的替换假称等价。工具与 UI 后续批次不在此表冒充已迁移；最终调度仍由 #171 再核对。

## 使用与证据

- `npm run test:logic` 与 `npm run test:service` 包含对应的新原生场景。
- `npm test -- --files '["tests/business.test.ts","tests/modification.test.ts"]'` 使用相同公开分派、原生报告与完整性校验。
- `npm test` 仍保留所有未迁移测试；缺报告、零收集、nonce/集合错误和失败不因 include 改动放行。局部通过不是固定提交完整验收。

开发先以公开入口验证 business 收集缺失红灯，再获得 7 项原生通过；HTTP 修改权文件原 Node 注册不能作为 Vitest 收集，改用原生生命周期后 7 项通过。整批 14 文件 66/66 通过；独立审查指出的提前失败清理缺口已修复并复验受影响文件，公开 typecheck 通过，扩大后的 `test:logic` 11 文件 59 项和 `test:service` 7 文件 27 项也均实际通过。原日志、报告、位置与环境由此次 run.json 索引，最终提交仍需独立检出完整验收。

代表热点选择 business、speech、speech-service、modification 四文件共 20 场景，固定 Node 22.23.3、同机 Linux、文件并发 1，禁用字节码缓存、无浏览器准备缓存，操作系统页缓存未受控；每组均无竞争检查。集成 #163 后的原 Node 三次为 4.673 / 4.660 / 4.671 秒，中位 4.671 秒。候选三次为 4.671 / 4.640 / 4.653 秒，中位 4.653 秒，约缩短 0.4%。该差异不足以证明有实质加速；本组不能以迁移完成冒充性能成功。原样本、报告 hash 与等价执行集合见 [测量索引](measurements.json)。不以开发整批时长或不同 runner 的 CI 历史相减宣称收益。
