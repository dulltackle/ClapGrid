# Linux 用户目录运行组件

首次打开或明确离线时，按[组件准备流程](../plugins/clapgrid/skills/open-clapgrid/references/linux.md)检查和补齐组件；日常在线重开按[打开流程](../plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)执行。本页说明组件来源与维护。

安装与启动入口为 `plugins/clapgrid/scripts/runtime-linux.sh`，决策见 [ADR0012](adr/0012-user-linux-components.md)。固定版本、URL、SHA-256 和目录布局以入口为准；`check` 输出实际使用的版本。系统中可用的组件逐个优先复用；两个媒体程序使用各自的 PATH 目录，避免补齐 ffprobe 时遮蔽已有的系统 ffmpeg，反向同理。

## 固定第三方来源

- Node：官方发行包。
- FFmpeg/ffprobe：BtbN 自动构建的 GPL linux64/linuxarm64 原包。静态链接第三方媒体依赖，仍需要 glibc 2.28+ 与兼容内核。FFmpeg 的 GPL 许可在原包 LICENSE.txt 中。
- 字体：notofonts/noto-cjk 固定 Release 的 `NotoSansCJKsc-Regular.otf` 单字重；SIL OFL 1.1 文本随插件并随字体安装。

BtbN 的[保留策略](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy)只保留最近 14 个日构建及两年的月末构建，故从 [ClapGrid 固定组件 Release](https://github.com/dulltackle/ClapGrid/releases/tag/linux-components-2026-10-21) 下载原包，不依赖上游清理周期。该 Release 长期保留原始二进制、对应 FFmpeg 本体源码、依赖源码、固定构建脚本和 SHA256SUMS；完整源码缓存的分卷拼接方式见 Release 说明。

维护者更换固定组件时应同时保留对应源码、构建脚本和许可，并校验两个架构的原包摘要；安装后的试运行及媒体能力检查继续执行。容器结果与实际 Codex 宿主交付分开记录（[#219](https://github.com/dulltackle/ClapGrid/issues/219)）。
