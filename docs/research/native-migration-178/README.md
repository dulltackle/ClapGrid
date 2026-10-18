# 制作归档、交付包与恢复的原生宿主迁移（#178）

五个原 Node 文件的163场景采用既有 forks、单 worker、文件串行、isolate 与零重试基线，执行者之间仍串行。唯一执行者清单仅将本批五项的 executor 改为 Vitest，原 all 范围保持；不增加并发资格。

| 文件 | 原实际场景 |
| --- | ---: |
| tests/production-archive-baseline.test.ts | 8 |
| tests/production-archive-node.test.ts | 95 |
| tests/production-archive-publication.test.ts | 17 |
| tests/production-package.test.ts | 38 |
| tests/production-package-restore.test.ts | 5 |

[逐场景映射](scenario-map.json)以历史实际报告的 file/name/nesting 为原件，保持全部163项身份；本票无新增业务场景。冻结旧 Python 3.12/3.14 包、原清单/索引与摘要、损坏流/PAX/路径攻击样本及人工/受控证明的语义均保留，不重生成历史来源。历史映射不是本轮通过证据。

## 逐例资源与时限

外层使用原生 test 与 onTestFinished。每个文件在注册测试前使用 vi.setConfig({testTimeout:0,hookTimeout:0})，保留原 Node 未显式设置测试及清理时限的默认。publication 的五项候选事件场景与一项 Linux EFBIG 场景仍保留显式40秒测试时限；observedPack 的30秒真实子进程等待上限、close等待及 watcher finally 回收不变。Linux专属场景保留原静态平台skip政策，不能把未执行计为平台通过。

archive-baseline 无临时资源。archive-node/publication 每例登记项目目录删除；真实 CLI 同步调用或 observedPack 的真实 child close 完成后才结束测试并进入逐例清理。package 每例的项目、外部攻击样本目录和恢复目录互相独立；多个删除回调改为原生LIFO不改变资源依赖，两目录组合回调内的原删除顺序保留。restore 的单回调仍按 project→restored 删除。无清理延后到文件结束，无新增通用宿主。

本批不修改全局 process.env；真实子进程的 PATH 与其他环境继续通过独立对象传入。不存在共享完整 node_modules 的真实临时仓库调用者，故无需引入临时仓库接口。archive-node/publication 的软链接和硬链接是被测攻击输入，不是依赖安装视图，保持原样。本工作树的共享依赖包与可写缓存由协调者建立的独立安装视图隔离。

## 公开命令与证据边界

`npm test -- --files '["tests/production-archive-baseline.test.ts","tests/production-archive-node.test.ts","tests/production-archive-publication.test.ts","tests/production-package.test.ts","tests/production-package-restore.test.ts"]'` 通过原公开入口收集、执行和汇总本批场景。保留真实 production.mjs pack/verify-package/evidence 子进程、真实 tar-stream/gzip 与独立恢复结果的断言。

首切片以原8项归档基线进行红绿验证：只改唯一清单时，旧 node:test 虽输出8项TAP通过，Vitest收集为零而公开入口失败；切换原生外层后8项真实通过。随后通过同入口验证全部5文件及类型检查，原始日志/报告由本次运行记录保存。局部证据不能替代父规格固定候选完整正式验收、性能结论或安装/实际宿主交付。
