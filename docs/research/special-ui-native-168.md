# 特殊条件及其余 UI 原生执行（#168）

本批基于 `0a7fb4009cd7ff3a21e22511cc7d70d997d4bc23`，迁移 layout、more-tasks、panel-targets、panel-update、row-hover、segment-draft、shell 七个文件的 16 个原场景。[逐场景映射](special-ui-native-168-map.json) 对照 #163 历史清单核对名称、文件和 scope，无缺失或新增冒充。全部浏览器模板字面量逐字节一致，原脚本、等待、断言、主题、视口及每例超时保持。

本批只切换测试注册与唯一 executor，不改 UI 产品行为。添加/独立焦点由 #166 负责；媒体、导出及画面说明由 #167 负责；编辑、搜索、长文案和选择由 #165 负责；已有 Playwright 核心由 #151 原归属保留。其他批次的完成状态需读取各自报告，此处不将归属声明当作已执行证据。仍有调用者的旧 helper 保留，最终统一收拢留给 #171。

`panel.check(script, fixture, width, height, options)` 新增 `options.colorScheme` 和 `options.buildDefine`。主题通过真实 CDP 媒体特性传入；构建参数传到既有 `buildBrowserScript` 的 define 输入，继续参与准备缓存身份，不缓存测试结果。more-tasks 保留 dark 条件，三个刷新场景保留原构建参数。缺失参数转发时，这三个真实业务场景全部失败；补齐后全部通过。三个场景使用相同的原 define 对象，证明参数转发恢复了原业务行为；同一脚本切换不同 define 的缓存隔离已有专项源码断言，本票尚未重跑，仍未验。

worker 复用真实 Chrome，每例独立 context/page、DOM、storage 和临时目录；沿用生产同源 CSS、原 CDP 输入及视口实测。缺浏览器直接失败；官方报告仍要求完整收集、每例 passed 且 retry 为零。清单的原 scopes 和严格 UI policy 不变。没有迁移本批之外的调用者，也未改变默认并发 1。

公开 `test-runner.mjs --suite all --files [...]` 完整执行本批七文件，16/16 passed，skip/todo/cancelled 均为零；`npm run typecheck` 通过。原生报告及统一报告保全于本轮运行目录 `168-development/`，执行日志为 `168-full.log`，命令与退出码为 `168-development-results.json`。这是未提交开发内容的定向验证，最终固定提交正式验收和跨票审查仍待执行。

代表热点为 `panel-update-panel.test.ts` 三个原场景。基线关闭 Node 字节码及浏览器构建缓存，单 worker，同机且无并发检查。有效三次完整公开入口耗时为 13.718 / 13.668 / 13.629 秒，中位 13.668 秒。另一次 13.887 秒因无法严格证明静默而排除，原件保留。原始报告、命令、身份和排除原因在运行目录 `before-168/`。用户明确续时60分钟后，在原候选308fbe5完成三次后测：13.879 / 13.580 / 13.455秒，中位13.580秒，相对旧13.668秒变化-0.64%，接近噪声，没有实质加速证据。每次三个原场景passed、retry0且独立nonce；实际bundle/styles缓存关闭、worker和Chrome及目录均收尾。基线未录逐例timings，只保留禁缓存环境和当时源码；候选报告外置而基线在原目录，输出I/O路径不同，OS页缓存未控制，不能声称条件逐字相同。原件及局限见[汇总及保全索引](check-161/README.md)。正式验收仍以最终固定提交完整报告为准。
