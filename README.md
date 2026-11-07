# ClapGrid

通过 Codex 右侧表格组织口播视频。产品契约见 [docs/product-contract.md](docs/product-contract.md)，术语见 [GLOSSARY.md](GLOSSARY.md)。

当前已支持本地项目创建／重开、口播片段新增、文案编辑、删除、重排、多行粘贴、明确范围操作、自动保存、表格与 Codex 交替修改、本地视频导入／复用／预览和业务 MCP。现已支持 TokenDance 配音、试听、带字幕全片导出和独立后台任务。Linux 正式插件提供组件准备入口；三平台完整交付仍需各自验收。

## 使用入口

| 要做的事 | 当前说明 |
| --- | --- |
| 在 Codex 中打开或重开项目 | 使用已安装的 `open-clapgrid`；[打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)区分在线重开、首次打开和明确离线 |
| 准备缺失的 Linux 组件 | [组件准备流程](plugins/clapgrid/skills/open-clapgrid/references/linux.md)；版本、来源与维护说明见 [Linux 用户目录运行组件](docs/linux-components.md) |
| 构建用于安装的插件包 | [业务 MCP 与插件](#业务-mcp-与插件) |
| 更新已安装插件并核对宿主 | [本机插件交付](docs/agents/plugin-delivery.md)，区分面板快更新与完整更新 |

## 运行条件

- Node.js **22.13 以上**；开发与构建另需 npm。Linux 正式插件的固定组件版本和复用规则见 [Linux 用户目录运行组件](docs/linux-components.md)。
- 视频处理要求运行进程的 PATH 中有 `ffmpeg` 与 `ffprobe`，FFmpeg 含 `libvpx` 编码器。Linux 正式插件按[组件准备流程](plugins/clapgrid/skills/open-clapgrid/references/linux.md)复用兼容组件或补齐缺失组件；开发模式缺失时明确失败。
- 采用 Node 内置 `node:sqlite`，无需单独编译 SQLite 扩展；Node 22 会输出实验性 API 警告。运行时要求与版本锁定记在 `package.json` 和 `package-lock.json`。
- Codex 桌面端须有右侧内置浏览器与宿主命令执行能力。外部浏览器仅可辅助开发，不能替代右侧验收。
- 首次 `npm ci` 需要联网。宿主限制安装、文件写入或后台启动时遵守其审批；拒绝后停止，不改变安全配置或替换执行路径。

## 开发与构建

在仓库根目录执行：

```bash
npm ci
npm run dev -- --project /绝对路径/验证项目
```

开发模式在 `http://127.0.0.1:48762` 同源提供 Vite 页面与 API，前端修改支持热更新，HMR WebSocket 复用当前 HTTP 端口。多个开发预览可通过不同的 `--project` 和 `--port` 同时运行，无需额外分配热更新端口；服务端修改需重新运行。开发模式是前台进程，Ctrl+C 正常停止。

检查命令与范围见[检查与验收](docs/agents/verification.md#开发检查)。构建并运行：

```bash
npm run build
npm run start -- --project /绝对路径/验证项目
```

`start` 是构建后的前台服务。独立后台服务的命令见[服务退出与中断恢复](#服务退出与中断恢复)。

## 项目目录与安全边界

正式插件将项目保存在工作空间的 `clapgrid/`。`clapgrid.sqlite` 保存项目和任务记录，素材、页面、风格及成片分别存放在 `media/`、`pages/`、`styles/` 和 `exports/`；后台启动日志位于 `service.log`。

服务仅监听 `127.0.0.1` 并核对 Host 和 Origin，同机进程仍可访问。预览通过已登记的素材身份提供，导入使用用户指定的来源，运行配置与密钥存放在项目外。文件访问规则见[本地文件与素材](docs/product-contract.md#本地文件与素材)。

## 画面素材与编排

在表格中打开本句的素材托盘，可导入素材或从项目选取。通过对话请 Codex 编排画面，再审阅片段合成预览。表格操作见[面板规范](docs/panel-style.md#表格信息组织)，制作流程见[画面编排制作约定](plugins/clapgrid/skills/open-clapgrid/references/composition.md)，风格编写见[内置风格](plugins/clapgrid/styles/README.md)。

## 内置风格示例

示例由 ClapGrid 片段合成预览生成，保留实际字幕层，播放时为静音。

| 风格 | 画面 | 示例片 |
| --- | --- | --- |
| [等距信息图](plugins/clapgrid/styles/iso-infographic/STYLE.md) | 止回阀从定位、纵剖到开启通路 | [12 秒 MP4](docs/style-examples/iso-infographic.mp4?raw=1) |
| [暖浅底科普风](plugins/clapgrid/styles/warm-science/STYLE.md) | 摆锤单主体、摆长对照、三组种子的数量与比例 | [18 秒 MP4](docs/style-examples/warm-science.mp4?raw=1) |

## 本机插件更新

更新已安装插件时先读[本机插件交付](docs/agents/plugin-delivery.md)，按实际安装来源执行更新，并依据运行时与协议是否相容选择面板快更新或完整更新。该文档统一维护命令、空闲条件、恢复位置及实际宿主验收步骤。

源码合并、安装完成与实际宿主加载分别报告；安装成功不能代替 MCP、服务和面板的实际验证。日常重开使用[打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)，更新后的验收仍按交付规程执行。

## 业务 MCP 与插件

```bash
npm run mcp
npm run plugin:build
```

| 用途 | 工具名（参数以 [`src/mcp/server.ts`](src/mcp/server.ts) 为准） |
| --- | --- |
| 项目与片段 | `clapgrid_status`、`clapgrid_query_segments`、`clapgrid_modify`、`clapgrid_process_segments` |
| 画面 | `clapgrid_import_material`、`clapgrid_import_video`、`clapgrid_visual_context`、`clapgrid_import_page`、`clapgrid_check_page`、`clapgrid_page_frames`、`clapgrid_import_style`、`clapgrid_set_project_style`、`clapgrid_preview_segment`、`clapgrid_visual_previews` |
| 配音 | `clapgrid_set_voice`、`clapgrid_submit_speech`、`clapgrid_submit_speech_batch`、`clapgrid_speech_status` |
| 导出 | `clapgrid_export_settings`、`clapgrid_set_export_settings`、`clapgrid_submit_export`、`clapgrid_export_status`、`clapgrid_cancel_export` |
| 打开与诊断 | `clapgrid_prepare_panel`、`clapgrid_host_context` |

业务规则见[修改权与任务锁](docs/product-contract.md#修改权与任务锁)和[表格与业务 MCP 的反馈](docs/product-contract.md#表格与业务-mcp-的反馈)。

`npm run plugin:build` 将 `plugins/clapgrid/` 的插件源与服务、MCP 及面板打包到 `dist/plugin/clapgrid/`。将完整目录接入个人插件市场并安装后，在新对话使用 `open-clapgrid`。安装与宿主验证见[本机插件交付](docs/agents/plugin-delivery.md)。

## 工作空间固定项目

在 Codex 中使用 `open-clapgrid` 打开当前工作空间的项目。重开、首次打开、明确离线和迁入旧项目的操作见[打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)。工作空间绑定与恢复规则见[运行、保存与恢复](docs/product-contract.md#运行保存与恢复)。

## 单片段配音

在本机用户目录的 `~/.config/clapgrid/.env` 配置 `TOKENDANCE_KEY`。Windows 使用用户主目录下的 `.config/clapgrid/.env`。

统一音色可选 vivi 2.0（默认）、流畅女声、儒雅逸辰。统一语速默认 1.0 倍，可用范围为 0.5～2.0 倍，以 0.01 倍递增。

在表格对应行选择「生成配音」。生成、试听和重试规则见[配音与统一声音](docs/product-contract.md#配音与统一声音)，密钥和异常处理见[凭据与在线服务异常](docs/product-contract.md#凭据与在线服务异常)。

## 全片导出

在表格打开[全片导出设置](docs/export-settings.md)完成配置，再选择「导出全片」。范围、校验、任务锁及取消清理见[全片导出](docs/product-contract.md#全片导出)和[修改权与任务锁](docs/product-contract.md#修改权与任务锁)。

## 服务退出与中断恢复

维护构建后的独立服务时，可在仓库根目录分开执行以下命令。启动后通过状态查询核对项目目录、实例和 PID。

```bash
npm run runtime -- start --project /绝对路径/验证项目
npm run runtime -- status --project /绝对路径/验证项目
npm run runtime -- stop --project /绝对路径/验证项目
```

明确选择中断任务并退出时，在停止命令末尾加 `--interrupt`。使用自定义端口时，各命令均附加原 `--port`。退出和重开行为见[运行、保存与恢复](docs/product-contract.md#运行保存与恢复)。

## 自动检查与本地复现

日常检查先读[检查与验收](docs/agents/verification.md)：准备环境、选择定向或完整检查，并按实际运行范围记录结果。该文档统一维护常用命令、CI 验收规则和性能结论的适用范围；命令定义以 `package.json` 为准。

排查 CI 时查看[原生 CI 说明](docs/testing/native-ci.md)中的执行接线与原始报告位置；旧测试机制的退出和产品保障承接见 [#200](https://github.com/dulltackle/ClapGrid/issues/200)。插件安装与实际宿主交付另按[本机插件交付](docs/agents/plugin-delivery.md)核对。
