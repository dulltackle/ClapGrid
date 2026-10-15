# #130 审阅证据边界验收说明

本轮实现规格为 [#130](https://github.com/dulltackle/ClapGrid/issues/130)，子事项为 #131、#132、#133、#134。源码研究及兼容基线固定为 `4dc7ac75e6a8e7d83b48923b4048ede47b5e9f4a`。本说明记录验收对应关系；最终受验提交、正式执行结果和事项关闭状态以运行记录及事项中的最终回写为准，不以文档存在推定通过。

运行记录保存在 `/home/forclaw/tmp/clapgrid-spec-130/run.json`，资源登记为同目录 `resources.json`。发现快照保存全部开放及关闭事项的分页结果、原生子事项、正文父关系与依赖证据。原始输入、前后报告、开发日志、审查覆盖及各子事项交接记录均保存在该目录。

## 验收对应关系

| 父标准 | 可观察证据及审查位置 |
| --- | --- |
| AC1 | 独立 OCR 逐文件审查 `evidence.mjs`、`evidence-report.mjs`、`sample.mjs`、`impact.mjs`；证据模块核对及复核，样片按独立身份消费，影响保留传播计算。 |
| AC2–AC3 | `production-evidence.test.ts` 真实入口回归：缺失、失败、待审、跳过、否决、类型/版本/来源/范围/路径/内容差异，最新对应结论、真实与受控历史隔离、显式复用及原来源、时间与证明。 |
| AC4 | `sample-baseline/colon-collision/` 保存同一隔离项目修复前后真实入口报告；两组合法身份生成同一 `direction:visual:video` 检查标识。旧样片 `failed / 1 / false`，修复后 `passed / 0 / true`。 |
| AC5 | `production-impact.test.ts` 真实依赖及媒体回归：输入变而输出字节不变仍需重审，直接/间接传播及原因、无关证据和原失败保持原判断。 |
| AC6 | `production-evidence-recheck.test.ts` 公开业务接口回归：同一基础结果用于不同影响集合，原结果、上下文与各复核互不污染，子项/要求/earned/受控/回写资格一致。 |
| AC7–AC8 | `production-sample.test.ts` 真实 CLI 与 FFmpeg/FFprobe：隔离模拟成功、其他终审待审成功、两项独立受控限制、范围/版本/内容/类型/证明/复用、静态/单帧/损坏媒体拒绝；完整解码同时检查错误输出。 |
| AC9 | 同一输入真实入口的前后完整 JSON 语义对照，保留稳定字段、消息、标识、状态及退出码；证据16场景、样片20场景、影响5场景。另列碰撞修复，不放宽其余差异。 |
| AC10 | `production-report-identity.test.ts`、`production-package-restore.test.ts` 及证据/样片/影响回归：原始记录、证明原件及归档恢复保持原字节，报告不能覆盖原件，命令不回写 GitHub。 |
| AC11 | `GLOSSARY.md` 保留审阅证据与证据复用的领域定义；ADR-0005 和 `docs/production-evidence.md` 说明最终职责、原结果与复核结果、报告兼容成本和碰撞例外。 |
| AC12 | 按 `docs/agents/verification.md` 对最终提交执行 `npm run verify -- --revision <提交>`；独立检出安装锁定依赖并运行类型检查、全部测试及构建，保存原始日志、环境与跳过项。 |

## 兼容与证据位置

证据前后对照由 `evidence-compat.py` 复用同一项目执行；样片由 `sample-baseline/reproduce.mjs` 保存真实媒体、模拟记录与前后结果；影响由 `impact-compat.py` 覆盖无 evidence、输入变化、稳定证明和已有失败。比较排除运行起止时间；路径按同一项目或明确映射对应，不删除业务字段。正式验收后再使用同一输入调用受验独立检出的真实 CLI，结果绑定其提交，不能用开发目录通过替代。

`reviewer/` 保存每次 OCR preview、适用规则、覆盖清单与独立技术阅读证据，包含条款原文、受审提交、文件位置及判断依据。最终审查核对完整基线到集成差分，补看共享契约、同步和文档，并记录先前覆盖的对应关系。

正式日志位于仓库忽略目录 `logs/verify/run-*/`：顶层 `summary.json` 记录受验提交、安装与检查结果，`source/logs/check/` 保存类型检查、测试与构建原始输出。运行记录保存本次精确目录和兼容检查结果；提交或检查范围变化后重新验收。

## 环境与结论边界

开发环境为 Node.js v22.23.3、FFmpeg/FFprobe 8.0.1、Google Chrome 155；最终独立检出的实际环境及跳过项另记录于正式结果。浏览器主题矩阵与媒体检查须实际运行，环境缺失或跳过不能赚得相应标准。

许可成功案例全部是隔离机制测试，模拟来源、证明文本及测试名称均保留该标识。`actual-project` 与 `user-confirmation` 仅是模拟输入声明，不说明实际用户观看、批准项目，也不构成真实制作许可。机械对应、依赖影响复核与样片用途检查各有范围；本轮不更新插件，不执行实际宿主交付，不替代领域准确性、发音听审或完整成片终审。
