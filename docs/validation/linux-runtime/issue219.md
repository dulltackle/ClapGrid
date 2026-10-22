# #219 Linux 用户目录组件验收

2026-10-22，对应 [#219](https://github.com/dulltackle/ClapGrid/issues/219)。本轮源码父提交 `ef66f53450e2b884c1d692647ad6f6c0ef95833e`，在同一工作区的 #219 候选上执行；固定组件原包由 [linux-components-2026-10-21 Release](https://github.com/dulltackle/ClapGrid/releases/tag/linux-components-2026-10-21) 分发。源码提交与实际宿主状态另按交付结果记录，容器结果不替代宿主证据。

## 自动检查与审查

- 类型检查通过；组件命令接口专项 11/11 通过。本机 Ubuntu 26.04、glibc、x86_64 的安装恢复专项实际执行，未跳过。
- 全套 Vitest：65 个文件、664 项通过，零跳过。
- Playwright：首轮 166 通过、1 项工作空间文案保存用例失败（刷新后显示原文）；该用例随后独立通过，再连续 5 次通过，完整 Playwright 重跑 167/167 通过。保留首轮失败及重跑记录，不把首轮 `npm run check` 写成通过。
- 生产构建、插件构建通过。真实 GitHub CI 本轮未运行，不能由本地结果推导通过。
- 一个只读子代理按 open-code-review-delegate 完整审查代码及额外文档/许可。两项 P2 均已处理：新增测试补 Linux/受支持平台条件；字体配置也通过保留异常目标后发布，修复 `fonts.conf` 是目录时无法恢复。后者用真实固定字体及摘要、真实 fc-list、受控 curl 复制离线原包，修复后 install/check 均退出 0；原始输出见 [font-config-recovery.txt](issue219/font-config-recovery.txt)。

失败路径测试使用受限 PATH 与临时组件目录，通过 install/check 观察退出码、stderr 和最终目录状态，覆盖缺 curl/fc-list、不支持架构/musl、断网重复重试保留用户 Node、摘要错误拒绝发布及清理、真实 flock 竞争、系统与用户媒体组件选择。

## 干净容器真实下载与运行

Docker 29.9.2；两组均为 x86_64，初始未安装 Node、FFmpeg、ffprobe 和中文字体。镜像及基础工具准备由 root 完成，然后以仅属于自身组的普通用户 maker（uid 1000）安装和运行。基础工具包括 curl、ca-certificates、tar、xz、coreutils、util-linux、fontconfig；它们是安装前提，不由插件下载。未给 maker sudo 权限，未使用管理员认证。

| 环境 | 固定镜像 | start 与独立 status 的同一服务 |
| --- | --- | --- |
| Debian 13 slim | `debian@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad` | PID 4050，`dfd12762-2370-4e95-8d15-0a47a941889d` |
| Fedora 44 | `fedora@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80` | PID 977，`745ed80b-6694-496d-b33f-7c91a529d7c4` |

两组实际顺序：初始 check 返回 10；普通用户 install 从正式固定 URL 下载，Node、FFmpeg 原包和字体各自 SHA-256 校验通过；重复 install 返回 0 并显示已就绪跳过；check 返回 0，输出 Node v22.23.4 及 FFmpeg/ffprobe `n8.1.3-20-gc8de997cb1`。所有组件位于 `/home/maker/.local/share/clapgrid/runtime`，安装前后未向系统路径或系统字体目录复制组件。安装后、显式 start 前没有运行项目服务。

随后用产品业务入口准备隔离项目：导入真实生成的视频、枚举字体并保存导出设置、通过真实配音处理路径保存合成音频。配音供应商是唯一受控边界，返回本地生成的 1 秒正弦 MP3，无收费调用；本项验证媒体处理与导出，不声称真实 TTS 供应商成功。

服务由正式 `runtime-linux.sh start --project /home/maker/validation/project --port 48762` 启动，下一次独立 docker exec 执行 status，核对同一 PID 与实例。读取实际服务进程的 PATH 和 FONTCONFIG_FILE，确认继承用户组件媒体目录和字体配置。通过 HTTP 的导出设置接口确认 `Noto Sans CJK SC` 在字体列表，再提交真实导出并等待 succeeded。

两组均产出 1920×1080、H.264/AAC MP4 和 WebM 预览。实际抽帧目视核对：无手工换行的整段中文自动排成三行，汉字完整可读，无缺字框。画面素材导入、配音处理、导出设置能力探测、成片及预览导出均运行下载的媒体程序；系统没有其他 ffmpeg/ffprobe 可用。

- Debian 原始材料：[安装](issue219/debian-install.txt)、[独立状态](issue219/debian-status.json)、[服务环境](issue219/debian-service-environment.json)、[导出](issue219/debian-export.txt)、[成片探测](issue219/debian-probe.json)、[字幕帧](issue219/debian-frame.png)。
- Fedora 原始材料：[安装](issue219/fedora-install.txt)、[独立状态](issue219/fedora-status.json)、[服务环境](issue219/fedora-service-environment.json)、[导出](issue219/fedora-export.txt)、[成片探测](issue219/fedora-probe.json)、[字幕帧](issue219/fedora-frame.png)。

复现时先准备上述镜像和基础工具，复制已构建插件到 `/home/maker/plugin`，以 maker 执行 `bash /home/maker/plugin/scripts/runtime-linux.sh install`、重复 install、check，再执行 start 与独立 status。本机原件目录保留准备项目和 HTTP 导出脚本。原始输出与截图按本仓库规则本机保留、退出 Git 跟踪；新 clone 中原件链接不保证存在。容器为本次专用资源，验证后正常停止服务及容器。

## 损坏组件恢复

导出结束并正常停止服务后，在 Debian 专用容器分别破坏已安装的 Node、FFmpeg 可执行文件，再以 maker 运行正式 install。两次均重新下载并校验对应原包，check 回到 0，损坏旧目录保留为 `.invalid.*`。使用实际 SHA-256 前后对比：修复 Node 时原 FFmpeg/ffprobe/字体不变；修复 FFmpeg 时 Node/ffprobe/字体不变。原始输出见 [debian-corrupt-recovery.txt](issue219/debian-corrupt-recovery.txt)。

## 分发与范围

Release 的 7 个资产状态为 uploaded，远端摘要全部与本地匹配：两架构原包、固定构建脚本、FFmpeg 本体固定提交源码、完整依赖源码缓存的两分卷及 SHA256SUMS。完整缓存源自 BtbN 同次构建运行 39601828709 的 download-cache artifact 12346534162；未用过期上游二进制 URL 作为产品下载源。版本、来源、许可和维护说明见 [Linux 组件文档](../../linux-components.md)。

本轮没有真实 ARM 硬件运行、其他发行版实机或 musl 自动安装验收；aarch64 原包仅实际下载并核对摘要，不将其记为执行通过。实际 Codex 宿主只读探测当前加载旧插件 `0.1.0+git.2f6fa2ac43fb.66725799ed71`，且工作空间服务不可达；后续本机安装与宿主重载结果以交付收据和聊天中的实际观测为准，本记录不声称宿主已更新可用。
