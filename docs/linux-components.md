# Linux 用户目录运行组件

安装与启动入口为 `plugins/clapgrid/scripts/runtime-linux.sh`，决策见 [ADR0012](adr/0012-user-linux-components.md)，实施事项为 [#219](https://github.com/dulltackle/ClapGrid/issues/219)。固定版本、URL 和 SHA-256 以入口为准；`check` 输出本次实际使用的版本。

组件根目录默认是 `${XDG_DATA_HOME:-$HOME/.local/share}/clapgrid/runtime`，可通过所有调用共同设置的 `CLAPGRID_RUNTIME_HOME` 覆盖。系统中可用的组件逐个优先复用；用户 Node 放在 `node/`，媒体程序分别放在 `media/ffmpeg/` 和 `media/ffprobe/`，字体及许可放在 `fonts/`。拆开两个媒体程序的 PATH 目录，避免补齐 ffprobe 时遮蔽已有的系统 ffmpeg，反向同理。

下载先在锁内的临时目录校验 SHA-256 并试运行，再发布组件。旧的损坏组件移动到同目录 `.invalid.<进程>.<随机数>` 备份；成功准备的组件保留供失败后重试复用。`fonts.conf` 包含系统字体配置与组件字体目录；入口把它通过 FONTCONFIG_FILE 传给服务、MCP 和后续媒体子进程。安装不会启动服务或制作任务。

## 固定第三方来源

- Node：官方 22.23.4，x64/arm64 的 SHA-256 延续现有入口。
- FFmpeg/ffprobe：BtbN `autobuild-2026-10-21-13-06` 的 `n8.1.3-20-gc8de997cb1`、GPL、8.1、linux64/linuxarm64 原包。静态链接第三方媒体依赖，仍需要 glibc 2.28+ 与兼容内核。
- 字体：notofonts/noto-cjk 的固定 Release `Sans2.004` 对应的 `NotoSansCJKsc-Regular.otf` 单字重；SIL OFL 1.1 文本随插件并随字体安装。

BtbN 的[保留策略](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy)是最近 14 个日构建及两年的月末构建，故从 [ClapGrid 固定组件 Release](https://github.com/dulltackle/ClapGrid/releases/tag/linux-components-2026-10-21) 下载原包，不依赖上游的清理周期。该 Release 长期保留原始二进制、对应 FFmpeg 本体源码、依赖源码、固定构建脚本和 SHA256SUMS；完整源码缓存的分卷拼接方式见 Release 说明。FFmpeg 的 GPL 许可在原包 LICENSE.txt 中。

维护者更换固定组件时应同时保留对应源码、构建脚本和许可，并校验两个架构的原包摘要；安装后的试运行及媒体能力检查继续执行。真实验收范围见 [#219 验证记录](validation/linux-runtime/issue219.md)，容器结果与实际 Codex 宿主交付分开记录。
