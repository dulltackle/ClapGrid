# 完整链测量与默认选择（#189）

同机同候选完整九轮各经独立审阅后，采用 `overlap-1+2`。本次仅将 `scripts/test-overlap.json` 的 `defaultMode` 从 `serial` 改为 `overlap-1+2`；三个原文件资格及文件/清单哈希不变。`overlap-1+1` 不满足采纳条件。收益较小，内存与 CPU 成本更高，全部原值保留。

## 公开入口与默认边界

```sh
npm run check
npm run check -- --execution serial
npm run check -- --execution overlap-1+1
npm run check -- --execution overlap-1+2
```

默认完整入口采用 1+2；显式 serial 保留第一步 Playwright 请求 2。三种模式均先集中复验，再强制 `typecheck → test:environment → test:tooling → test:rows`。剩余独占文件先运行，只有原 `export-tasks.test.ts`、`audio-panel.test.ts`、`video-panel.test.ts` 的资格及哈希吻合才允许执行者重叠；未知或失效资格仍独占。Vitest 仍为单 forks worker、文件串行、isolate、retry 0。Playwright 的 rows 预检请求始终为 2；serial 的主测试仍请求 2。重叠模式按 rows/独占段/取得资格段依次为 1+1 的 2/1/1、1+2 的 2/2/2，原生文件调度和逐例隔离不变。直接测试、预检、复验、UI/相关入口没有新增重叠权限。

测量候选固定为 `f049da10cd1743288751fa190283a8dce80b3e90`，其默认仍是 serial；九轮全部使用显式 `--execution`。当前默认变更是后续候选，不能把 f049 的完整通过当成新提交的默认完整通过。最终 commit/源码身份保存在外置 `189-closeout/final-source-identity.json`，交 #190 执行默认完整固定提交正式验收和适用实际 PR CI。无待办 `npm run check -- --failed` 的红前/绿后原件只验证默认选择，零复验不是 full；现有定向回归与 typecheck 也不替代 #190。未新增生产测试，测量 Counter 仍为 1155；最终以 #190 原收集为准。

## 九轮完整入口结果

| 轮次 | 显式模式 | wall / runner 占用（秒） |
| --- | --- | ---: |
| 1 | serial | 1746.200523178 |
| 2 | overlap-1+1 | 2116.758296496 |
| 3 | overlap-1+2 | 1734.489127710 |
| 4 | overlap-1+1 | 2117.809133156 |
| 5 | overlap-1+2 | 1731.852652263 |
| 6 | serial | 1747.872144555 |
| 7 | overlap-1+2 | 1732.680681460 |
| 8 | serial | 1747.580739308 |
| 9 | overlap-1+1 | 2117.728846826 |

| 模式 | 完整链 wall 中位数（秒） | 三轮总 runner 占用（秒） | 冻结门槛 |
| --- | ---: | ---: | --- |
| serial | 1747.580739308 | 5241.653407041 | 基线 |
| overlap-1+1 | 2117.728846826 | 6352.296276478 | 不满足 |
| overlap-1+2 | 1732.680681460 | 5199.022461433 | 满足 |

1+2 中位数减少 14.900057848 秒，约 0.85%；三轮总 runner 占用减少 42.630945608 秒。采纳条件仅为完整链中位数严格下降、三轮总 runner 占用不增加、覆盖及清理全部通过；不增加加速百分比或内存阈值。全部九轮均为 110 文件、1155 用例（1154 passed、1 个原普通非 UI skip），196 个 Playwright 用例零重试。正式 nonce 逐个绑定原 marker/container 及恰好一份 removed/groupsEnded 收据；临时登记目录、唯一 fixture 根、全部原 birth/group/cgroup drain 分列，不能合成收据或按前缀认领。每轮详细目录数和实际原生区间在索引原件中。

## 内存、CPU 与开销

| 模式 | 三轮内核计费 peak（字节） | 内核 peak 中位数 | 三轮 cgroup CPU 总使用（秒） |
| --- | --- | ---: | ---: |
| serial | 2903187456 / 2751938560 / 2709221376 | 2751938560 | 8386.932706 |
| overlap-1+1 | 2483093504 / 2529009664 / 2505973760 | 2505973760 | 8338.259078 |
| overlap-1+2 | 3395936256 / 3356393472 / 3018395648 | 3356393472 | 8485.224612 |

1+2 相对 serial 的内核 peak 中位数增加 604454912 字节，三轮 cgroup CPU 总使用增加 98.291906 秒。100 ms RSS 观测 peak 中位数为 serial 5451689984 字节、1+1 5444304896 字节、1+2 5939728384 字节，1+2 增加 488038400 字节。RSS 是观测下界，可能重复计算共享页，不等于物理独占内存。独立 scope 的内核 `memory.peak` 为主；CPU、RSS、collector/sampling CPU、扫描及 observer 开销均在 [measurements.json](measurements.json) 逐轮保留，不从 wall 相减，observer elapsed 含等待而非可加开销。

九个原 scope 的 memory.events 为 0，后测主机容量另存独立审阅来源。后测容量不能恢复测时精确余量，也不证明托管 CI 的可用容量。此处据实记录更高资源成本，不把小幅 wall 改善描述为全面资源下降。

## 条件、原始来源与保留

九轮使用同一个普通 Git worktree、同一锁定 private 安装的 8309 文件；Node v22.23.3、npm 10.9.9、Chrome 155.0.8059.84、FFmpeg/ffprobe 8.0.1，Linux 7.0.0-38-generic x64。每轮显式同 cwd、login true、`LANG=C.UTF-8 LC_ALL=C.UTF-8`；direct 环境所有字段前后严格一致，actual npm 所有字段含 PATH 跨九轮独立严格一致，两种上下文不硬比。完整环境指纹、工具路径、字体指纹及每轮起止时间、命令、配额、结果见 measurements.json。

每轮将 `node_modules/.cache`、`.vite`、`.vite-temp`、`.vitest-cache` 及项目 `.cache/browser-build` 正常 rename 至外置 `round-N/cache-kept`，再重建私有空目录，不重装依赖；OS 页cache 未清。因此是项目私有缓存为空的同机顺序对照，不是全机冷启动。原始 monotonic wall 从原 CLI spawn 到 exit 加全部 owned drain，含嵌套 Chrome、FFmpeg 和子测试；不是执行者或场景耗时之和。准备和测后分析在 wall 外，计时中只轻量捕获原 owner 环境，字体、工具和源码摘要在计时结束后派生。

[sources.json](sources.json) 保存九轮 hash 索引、独审 gate 与 root 采纳依据的原路径/SHA256。完整 raw 仍保留于 `/home/forclaw/tmp/clapgrid-174-run/189-v3/` 及测量 worktree 的原日志路径；未将大日志复制入仓，也不声称仅凭仓内摘要可重放全部原验收。旧 163/v1 首测 CLI passed 但 cleanup failed，以及 189-v2 首轮 CLI/cleanup forensic passed 但 direct 环境严格 gate failed，均永久 invalid，不追认、不计新九轮；旧字节和历史未知/同 path 冲突资源映射保留。

本机中位数不承诺托管 CI 固定分钟数。该源码决策、#190 最终默认正式验收、适用 PR CI、安装包与实际插件宿主更新分别交付；此切片未更新安装包或实际宿主，未自动合并。
