# Linux 运行原型归档结论

对应 [#10](https://github.com/dulltackle/ClapGrid/issues/10)，2026-09-25。用户授权将缺口转交并归档证据。本目录是一次性原型，保留于 `codex/prototype-runtime-lifecycle`，不合入主分支，不作为生产服务。

## 已回答的问题

在 Ubuntu 24.04.5 LTS、Python 3.12.3、Codex 26.917.71314 环境中，已安装插件的技能能从缓存调用启动器并经宿主工具打开右侧表格。文案保存恢复、VP8 播放拖动、关闭面板后任务继续、显式中断及异常中断恢复均有实测或用户证据。

完全退出 Codex 前 PID 288387、任务 70ddcfd5-ffd1-49c2-a58a-e0669dfe9dd7、进度 142/180；重开后先读状态，PID 与任务 ID 不变，进度 180/180、已完成。没有通过重启服务伪造旧进程存活。

结论：此 Ubuntu 环境支持所选运行方案的原型可行性。默认沙箱子进程不能持久存活，宿主执行审批启动可行；这是交付约束，不是无审批保证。VP8/Opus 预览通过不意味着原始 H.264/VP9 宿主问题已经修复。

## 未验证与后续

- Windows 实机：[#11](https://github.com/dulltackle/ClapGrid/issues/11)。
- macOS 实机：[#12](https://github.com/dulltackle/ClapGrid/issues/12)。
- 缺少运行组件时的首次安装及宿主审批启动交付：[#13](https://github.com/dulltackle/ClapGrid/issues/13)。
- Ubuntu 实际音频听感：[#14](https://github.com/dulltackle/ClapGrid/issues/14)。

三平台要求不变；产品项目管理、普通编辑修改权、多项目切换和真实配音/导出不在本原型范围。后续规格核对应保留以上未验证项，不把 #10 关闭当作产品或三平台交付通过。

## 证据索引

- `evidence-api.json`：编辑锁、重复启动、退出保护及中断恢复。
- `evidence-installed-session.json`：安装后新任务的原始基线、重开、冷启动及服务复用。
- `README.md`：环境、运行步骤、用户反馈、历史过程与结果矩阵；历史“尚未提交/待确认”文字应按其记录时点阅读，以本归档结论为准。
- `media-probe/RESULTS.md`：媒体对照实验及失败归因边界。
- `VALIDATION.md`：后续平台逐项实测规程。
- `clapgrid-runtime-probe.zip`：已安装 0.1.0 插件快照，包含 manifest、技能、启动器、页面和合成媒体。
- `SHA256SUMS`：归档资产校验值（不包含本清单自身）。

结构化新会话记录中的 text_save“待用户确认”只描述该轮未重测保存；保存与恢复的此前证据见 README 与 #10 历史用户反馈，不改写原始样本。
