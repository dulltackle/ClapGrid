# 最终集成与验收索引（#174、#190）

本轮将 54 个常规 Node 文件的外层宿主迁入 Vitest，保留真实 Node/TAP 与历史兼容调用；常规完整检查采用取得资格文件的 `overlap-1+2`。交付范围为源码及检查体系。插件安装包和实际宿主未更新，未发布；父事项 #174 保持正文和状态，不自动合并 PR。

本文是稳定候选的运行说明与证据导航。最终提交、源码指纹、正式 runId、实际 PR/CI 检出身份及结论由外置验收记录保存，避免回填结果再次改变受检候选。本文写入时，最终默认候选的独立固定提交正式验收、实际 PR 全量检查和独立 Linux 进程追踪仍待执行；尚未发生的合并后 main push 明确待验。旧 PR #191 的 `6a73bdc` CI、第一步正式和九轮测量均不替代最终候选。

## 完整入口与身份

```sh
npm run check
npm run check -- --execution serial
npm run check -- --execution overlap-1+1
npm run check -- --execution overlap-1+2
npm run verify -- start --revision <最终提交SHA>
npm run verify -- status --run <原runId>
npm run verify -- wait --run <原runId>
```

完整 `check` 默认 1+2，显式 serial 保留第一步；`verify` 在独立检出安装锁定依赖，执行类型检查、完整测试、生产构建、源码变化与来源核对。启动只进行一次，沿原 runId 查询；观察者退出不取消实际 worker。普通开发结果和零待办 `--failed` 不取得正式资格。清理须核对原 pid/birth/namespace、登记组、资源和专属 cgroup，全部本次后代退出后解锁；未知归属保留现场。

三种模式均先集中失败复验，再强制 `typecheck → environment → tooling → rows`，同次累计仅引用本次同身份实际通过来源。独占剩余集合先运行，只有集中资格文件和清单 SHA 匹配才允许两执行者重叠；当前资格仅 `export-tasks.test.ts`、`audio-panel.test.ts`、`video-panel.test.ts`。新增、未知、改写或失效条目默认独占。Vitest 统一 forks、1 worker、文件串行、isolate、retry 0；Playwright rows 请求 2，serial 主段请求 2，1+1 的独占/资格段请求 1/1，1+2 为 2/2。直接测试、复验、UI/相关入口不自动获得重叠权限。

原始 110 文件、1099 场景（Node 817、既有 Vitest 86、Playwright 196）逐项映射保留。迁移新增 14、#187 新增 7、#188 新增 34、共享工作空间泄漏回归新增 1，共 1155；普通 Linux 组件安装场景保留 Ubuntu 24.04 能力政策。此本机环境应为 1154 passed 和 1 个原普通 skip，196 Playwright 全 passed、retry 0；其他平台按原政策真实核对，不把普通 skip 扩大到严格 UI。用例身份 Counter 与文件集合逐项核对，数量不能替代行为映射。

## 两步验收与已知修复

第一步 `727c9b7cfbcca7f4d706a5434d7ab16b4cb9406a` 的 `run-0GQoAE` 为 1113 场景的独立串行正式历史。第二步首次完整测量发现真实共享工作空间服务复活泄漏，原失败不追认为通过；`f049da10cd1743288751fa190283a8dce80b3e90` 修复后，新串行正式 `run-2R2ksq` 完整执行 1155 场景并独立核对 8679 个原进程身份、1168 个登记组全部退出，恢复受影响的 #186 清理保障。两次正式分别保留，均不冒充最终默认候选。

#175 的公共临时仓库接口集中私有依赖视图、环境与清理；`.cache/.vite/.vite-temp/.vitest-cache` 不共享写入。#183 工具故障注入曾因包根软链接泄漏，已按锁定包恢复并修正真实复制边界；#185 的 Vitest cache 外泄反例及公共修复保留 red/green。#188 修复取消祖先登记丢失与单次组快照漏收迟到后代；1+1、1+2 各 15 故障、迟到多层后代、foreign 工作树与 30 次失败集中复验有真实来源。正常失败继续收集另一 lane，取消才收齐本次两路及迟到后代，其他工作树不受影响。

Node adapter/TAP reporter/旧归一化与兼容导出仍有真实 Node 小仓库、原生报告和冻结历史调用者，故本阶段保留；[调用与替代保障审计](../native-migration-186/README.md#node-adapter-审计)逐项说明。常规文件调度、收集和逐例生命周期交原生框架，项目保留资格、唯一归属、code-check-v1、原始完整性、同次累计、失败复验、工作树互斥及拥有者清理。没有以零 Node 子进程为目标，也没有为删除单行兼容表面另造接口。

## 父规格十二项对应

| 父验收项 | 证据与边界 |
| --- | --- |
| 1 全部迁移及完整覆盖 | [1099 原场景逐项映射](../native-migration-186/scenario-map.json)、#176–#185 各批映射；72 Vitest/38 Playwright 唯一归属。最终候选完整执行另验。 |
| 2 Node/TAP、历史及逐例语义 | [宿主语义](../native-migration-176/README.md)、[阶段审计](../native-migration-186/README.md)；真实子进程、时限与清理原件及修复后串行正式。 |
| 3 缓存与资源隔离 | #175 公共隔离、#183 软链故障修复、#185 四 cache red/green 及 [#188 故障边界](../native-overlap-188/README.md)。 |
| 4 第一步串行正式 | `727c9b7/run-0GQoAE` 历史与修复后 `f049da1/run-2R2ksq` 独立锁定安装完整正式；不以性能成立为前提。 |
| 5 资格、独占与预检 | [#187](../native-overlap-187/README.md)、集中 `scripts/test-overlap.json`；未知默认独占，公开命令反例验证预检阻塞。 |
| 6 两配额与原始报告 | [#188](../native-overlap-188/README.md) 的真实两配额资格与独占、分 lane 原生报告和完整性校验；196 UI 零重试。 |
| 7 失败、取消与后代 | 两配额各 15 故障、迟到三层祖先/Chrome/FFmpeg/嵌套测试、foreign 存活及共享服务泄漏修复原件。最终正式清理另核。 |
| 8 严格完整性与复验 | #182、#184 真实公开 CLI 反例，#188 两配额故障及 30 次集中复验；错身份、零收集、缺报告、UI skip/todo 与损坏来源仍失败。 |
| 9 三模式各三轮 | [九轮数据与方法](../native-overlap-189/README.md)、[原件 SHA 索引](../native-overlap-189/sources.json)，同机同 f049、同覆盖和安装。 |
| 10 默认采用依据 | 1+2 wall 中位数 1732.680681460s，serial 1747.580739308s；三轮 runner 总占用 5199.022461433s 对 5241.653407041s，清理/覆盖全过。1+1 不采用。 |
| 11 适配保留与替代 | [Node adapter 调用者审计](../native-migration-186/README.md#node-adapter-审计)，实际调用者继续保留，框架接手常规调度；无强行删除。 |
| 12 最终正式、CI 与文档 | 本文、ADR0009、验证协议；最终固定提交正式及实际 PR/trace 仍待原件，尚未发生的 main push 待验，分列 target/checkout。 |

以上是证据对应关系，不是父事项验收勾选；父事项不改写。每个 #175–#190 当前验收条文还须独立逐句核对，不能用父十二项或总通过数替代。当前原件及审查路径在 [sources.json](sources.json)；外置 `190/criteria-evidence-plan.json` 保存父与全部子事项 exact text、历史执行/审阅对应、最终正式和 CI 缺口，由独立 reviewer 技术判断后才可供协调者写回。

## 性能与 CI 分列

九轮完整入口在 f049 上显式指定模式，顺序为 serial、1+1、1+2、1+1、1+2、serial、1+2、serial、1+1，采纳严格使用原门槛：完整链 wall 中位数下降、三轮总 runner 占用不增、覆盖和清理全过。1+2 中位数仅减少约 0.85%，内核 peak 中位数由 2751938560 增至 3356393472 字节，CPU 也增加；后测容量不是测时精确余量或托管 CI 容量保证。原无效首轮泄漏和 LANG 不同轮永久不计九轮；#161 与更早试点的历史性能缺口不改记为通过。

最终正式是新候选的独立 `verify`，不是性能第十轮。每个 PR 继续全量并验证默认合并结果，main push 验证 main 提交，保留 workflow_dispatch、既有取消分组、check 60 分钟和 process-trace 15 分钟。独立 Linux 追踪与完整 check 分别执行，不能并行污染追踪的全局拒绝窗口；不跨事件复用成功。实际观察分别保存 event target/head、真实 merge checkout SHA、job started/completed 与 ci-timing 窗口，后者不含 runner 准备和上传，不能冒充作业总时长。

源码候选、适用 PR CI、尚未发生的 main 事件、插件安装包、实际宿主分别报告。临时资源由协调者在成功 handoff 后逐项核对原接口、当前身份/占用、恢复材料及实际删除结果；四个历史同 path 双 hash 冲突映射与六个旧后代 unknown 保留，不宣称 registry 全部 clean。主工作区用户补丁不纳入本轮修改。
