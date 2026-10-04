# #29 Linux 正式插件交付

最新续验见 [2026-10-03 当前桌面记录](session-2026-10-03/README.md)：已实际发现技能及 MCP，完成正式插件右侧播放、人工听音和新带字幕导出；修复 FFmpeg 8 帧时长字段兼容问题。干净桌面首装仍未验证。下文保留 2026-09-28 的历史范围与原始结论。

本轮对象是正式 `clapgrid` 插件，源提交基线为 `d3fbdbc`，首次安装版本 `0.1.0+codex.20260928171313`；审查修复后正式重装版本 `0.1.0+codex.20260928172029`。原型 `clapgrid-runtime-probe` 的证据仅供参考。

## 实测环境与范围

- Ubuntu 24.04.5 LTS，x86_64；Codex 桌面包版本 26.924.22138，CLI 0.158.0-alpha.2.1。
- 桌面已具备 Node.js 22.23.3、FFmpeg/ffprobe 6.1.1-3ubuntu5。具体版本和编译组件见 `host-components.txt`。
- 正式插件源注册于个人市场，CLI 实际安装到 `/home/forclaw/.codex/plugins/cache/personal/clapgrid/0.1.0+codex.20260928171313`。此后组件检查、服务启动与 MCP 协议调用使用该缓存。
- 干净组件安装使用 `ubuntu:24.04` 容器，Docker 29.8.1。先准备 curl、ca-certificates、xz-utils，再运行正式脚本；基础系统自带 bash、coreutils、util-linux。容器结果不代表干净 Codex 桌面首装。
- aarch64 使用官方对应归档与摘要，尚未实测；其他发行版仅可检查/复用兼容组件，不支持本安装器自动安装。Windows/macOS 不在本事项实测范围内。

## 组件与安装机制

`plugins/clapgrid/scripts/runtime-linux.sh` 是 Linux 公共入口。`check` 不写入、不联网；`install` 单独准备组件；`start/status/stop` 调用已有正式后台协议；`mcp` 只启动 stdio 适配器，不启动服务。

Node 优先复用 PATH 中包含 `node:sqlite` 的 >=22.13 版本，否则复用用户组件目录。缺失时下载 [Node.js 官方 22.23.3 归档](https://nodejs.org/dist/v22.23.3/)，校验脚本内固定 SHA-256，解压验证成功后发布到 `${XDG_DATA_HOME:-$HOME/.local/share}/clapgrid/runtime/node`。可通过 `CLAPGRID_RUNTIME_HOME` 指定组件根目录；它必须在日常入口和 MCP 中保持一致。默认不修改系统 PATH，不在插件缓存内安装组件，重新安装插件不丢失组件。

FFmpeg/ffprobe 与中文字体从 Ubuntu 软件源安装 `ffmpeg fontconfig fonts-noto-cjk`，需要管理员权限。安装前检查编码器及 subtitles 的 wrap_unicode 支持；具体导出字体仍由正式导出设置验证。下载安装有时间上限、摘要校验及安装互斥锁；失败不启动服务或制作任务，临时下载目录清理，已经完成的组件保留供重试。

退出码：0 成功；2 用法错误；10 组件缺失/不兼容；11 不支持自动安装的系统/架构；12 缺管理员权限；13 下载、校验、包管理或安装后检查失败。后台业务命令沿用 runtime 的退出码。

## 可复现正式安装

以下均由 Codex 执行；用户只指定制作项目和处理宿主必要审批。开发源码构建需要 npm，安装成品插件无需 npm。

1. 仓库根目录 `npm ci && npm run plugin:build`，产物为 `dist/plugin/clapgrid`，不可安装只有模板的源码目录。Linux 构建会把 MCP 指向 `bash scripts/runtime-linux.sh mcp`，使其使用相同 Node 选择器。
2. 首次个人市场注册，使用 plugin-creator 的 `scripts/create_basic_plugin.py clapgrid --with-marketplace --with-skills --with-mcp`；由宿主许可写入个人目录。将完整构建目录内容复制到 `/home/forclaw/plugins/clapgrid/`。这一步是本机开发安装方式，不代表已有公开发布渠道。
3. 使用 `scripts/read_marketplace_name.py` 校验市场名，再执行 `codex plugin add clapgrid@personal`。更新既有插件时先使用 `scripts/update_plugin_cachebuster.py plugins/clapgrid` 更新版本、重新构建并复制，再安装；不手工改市场文件。三个脚本均来自 Codex 的 plugin-creator 技能目录，实际绝对路径由当前环境技能目录解析。
4. 新会话调用 `open-clapgrid` 并给出本地制作项目。技能从已安装路径执行 `bash <插件根目录>/scripts/runtime-linux.sh check`；退出 10 时，经宿主许可运行 `install`，成功后再次 check。缺基础工具时先通过系统包管理准备；下载失败保留错误，解决原因后显式重试。
5. 执行 `status --project <绝对路径>`；仅明确离线时，经宿主执行审批调用 `start --project <同目录>`。随后在另一次工具调用中运行 status，核对项目身份、PID、instanceId；同项目重复 start 必须复用原实例。
6. 使用 `open_in_codex` 在 right 打开 status.url，再实际读取内置浏览器表格。`queued` 本身不算成功。调用插件 `clapgrid_status` 核对相同实例；若首次加载时无 Node，准备组件后新会话重新加载 MCP。
7. 自定义端口须为所有后台命令传入同一 `--port`，并给 MCP 配置 `CLAPGRID_SERVICE_URL=http://127.0.0.1:<端口>`。配音密钥存于用户目录 `.config/clapgrid/.env`，不属于制作项目。通过正式表格/MCP 导入视频、生成配音、保存导出设置并导出。

任何安装或启动审批被拒均停止该操作，不改策略、不换执行路径。安装成功不代表启动获准；stdio 适配器退出或关闭表格不终止后台任务。停止服务使用 stop，有任务默认返回 kept；仅明确中断后使用 --interrupt。

## 已执行证据

- TDD 公共边界：脚本退出码、真实组件可用性及重复安装。`tests/linux-components.test.ts` 三项均先观察失败再实现通过；覆盖缺组件退出 10、基础工具错误及恢复后重试、断网条件下复用已有组件。测试不触发实际系统安装。
- 容器初始缺 Node/媒体组件，check 退出 10，见 `container-missing.txt`。设无效 HTTPS 代理后实际下载失败，退出 13 且提供重试提示，见 `container-download-failure.txt`。
- 恢复网络后真实下载官方 Node、校验摘要并安装 FFmpeg/中文字体，见 `container-install.txt`。再次 check 和两次 install 成功，安装均跳过，见 `container-ready.txt`。
- 宿主从正式缓存 check/install 成功并复用组件。经宿主执行审批 start 后，独立 status 和重复 start 保持同一 PID、instanceId 和项目身份，见 `host-start.json`、`host-status.json`、`host-reuse.json`。
- `open_in_codex` 返回 queued 后，通过内置浏览器实际打开 `http://127.0.0.1:48929`，读到“本地服务已连接”和正式表格。没有用外部浏览器替代。
- 正式缓存 MCP 经 SDK stdio 连接，查询同一实例，通过业务工具新增片段、导入合成测试视频、关联画面和保存导出设置，见 `mcp-prepare.json`。这是正式包协议验证；当前会话没有发现新插件工具，不冒充新会话宿主加载验证。

## 证据复用与未验证项

- [#13 原型安装与审批记录](../linux-runtime/README.md)及其 delivery-evidence 保留了真实允许/拒绝与跨调用证据。本次正式服务另行实际通过启动审批；未制造一次新的正式插件拒绝，也未修改安全配置。拒绝分支继续采用原型已验证的宿主规则。
- [#14 Ubuntu 听音记录](../linux-runtime/audio-listening.md)是远程桌面音频路径的人工证据，不代表本次正式配音已经听到。
- 干净 Linux 桌面原型首装仍由 #15 承接。正式插件的干净 Codex 桌面组件首装尚未验证：当前桌面已有组件，容器不含完整 Codex 桌面流程。
- 当前会话开始于安装前；尚需新会话实际发现 `open-clapgrid` 和业务 MCP。CLI 安装成功、缓存脚本及 SDK 协议通过都不能替代它。
- 真实制作任务跨完整退出及实际重启恢复沿用 [#26 正式产品证据](../issue-26.md)，并在三平台 MVP 总验收汇合；本次不重复要求退出，也不把运行容器当作桌面生命周期证明。

以上缺口保留未验证，不以文档说明、原型结果或用户笼统认可替代实际运行。

## 审查与回归

完整 `npm test` 首轮 94 项通过；类型检查、正式插件构建及插件/技能结构验证通过。只读代理使用 open-code-review-delegate 审查后，发现字体组件检查遗漏及测试在缺组件宿主可能触发安装，两项均已修正并经同一代理复核。新增缺 `fc-list` 的公共入口测试先失败后通过；当前组件测试 4 项和类型检查均通过，容器亦使用修改后脚本重新 check/install，见 `container-ready-fontconfig.txt`。常规测试的真实 install 仅在只读检查已就绪后执行；实际缺组件安装在隔离容器完成。

容器中将完整构建包复制为 `/installed`，使用刚安装到用户目录的 Node 实际启动、独立查询和复用服务，见 `container-start.json`、`container-status.json`、`container-reuse.json`。说明无需系统 PATH 中已有 Node，但仍不代表 Codex 桌面首装。

正式右侧表格打开素材预览，观察到 video 的 currentTime=5.348635、duration=6、paused=false、muted=true、readyState=4，无播放错误；见 `video-preview.png`。素材是本地生成的真实 MP4 测试图，非用户实拍文件；预览按产品规则静音。

审查修复后重新构建并通过个人市场安装最终版本 `0.1.0+codex.20260928172029`，新缓存的 check 和重复 start 通过，复用原服务身份，见 `host-components-final.txt`、`host-updated-reuse.json`。新旧缓存的服务/业务代码相同，新增修复仅在组件检查入口和测试。

## 正式插件的真实配音播放与新成片

正式配置尚未设置；用户是否允许将仓库 TokenDance 配置写入用户目录及新生成配音的询问尚未获得答复，本轮没有读取/复制密钥，也没有发送新供应商请求。

为独立完成媒体播放与导出验证，将 #26 已有的真实配音项目归档复制到 `.cache/issue-29/media-project`，原项目不变。停止本轮无任务的空白验收服务后，经宿主执行审批使用最终安装缓存启动此副本，仍使用端口 48929。服务包含两条有效配音；来源、任务与输入快照见 `media-start.json`、`media-speech.json`。这是正式产品已有媒体复用，不是原型合成音效。

在右侧表格通过“试听”打开第一条真实供应商配音，播放器播放至 2.664 秒结尾，未静音、readyState=4、无错误，见 `audio-playback.json`。这证明播放器流程和解码，**未获得本轮人工听音确认**。

在同一表格点击“导出全片”，实际完成新的导出任务 `1fd0c47c-242e-4475-b5db-2500654e7e2b`，按两条片段完整输出，第二条显示末帧冻结提示。新文件位于该副本的 exports 目录，没有重用历史成片作为新结果。输出 1920×1080、25 fps、16.96 秒 MP4，完整 FFmpeg 解码通过，SHA-256 `8c83e00e97eb0ccf2f649e76b73f9fc06c84f9ce85ff67c08973ef4a9a5ba4c5`。完整任务、媒体参数与摘要见 `export-status.json`、`output-verification.json`。

由表格显示的预览 URL 在 Codex 内置浏览器打开新成片，实际显示烧录中文字幕，兼容预览播放至 16.963 秒，未静音、readyState=4、无错误，见 `export-preview.png`、`export-playback.json`。试听/成片的扬声器听感仍待人工确认。没有把原型 #14 的听音结果直接算作本轮通过。

容器补验：移除隔离容器中的 FFmpeg 后，以 nobody 用户执行最终脚本，明确返回 12（管理员权限不足），见 `container-permission-failure.txt`；改由该容器管理员安装后，同一组件目录由 nobody 检查通过，见 `container-permission-retry.txt`。这不是宿主审批拒绝；#13 的真实拒绝证据仍单独引用。

本轮最终边界：正式包安装、组件准备/失败/重试/复用、独立服务及右侧素材预览、真实配音解码播放、新的带字幕导出已运行。新会话技能/MCP 发现、正式干净桌面首装、本轮人工听音尚未通过，#29 保持开放。未停止供人工验收的宿主服务，容器验收结束后停止。
