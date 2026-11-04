# ClapGrid

通过 Codex 右侧表格组织口播视频。产品契约见 [MVP.md](MVP.md)，术语见 [GLOSSARY.md](GLOSSARY.md)。

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

`start` 是构建后的前台服务。独立后台启动与查询：

```bash
npm run runtime -- start --project /绝对路径/验证项目
npm run runtime -- status --project /绝对路径/验证项目
```

两条命令应分开执行，核对同一 `instanceId`、PID、项目目录。启动器仅在连接被拒绝时创建服务，同项目则复用，其他项目或未知服务占用端口则报错。默认沙箱可能清理脱离的进程，此时应由 Codex 经宿主审批启动，之后独立查询确认，不能以首次命令返回 0 声称后台存活。

服务运行于独立进程，关闭面板或 MCP 不影响任务。使用 runtime stop 退出；有任务时默认保持服务，仅明确选择中断后加 `--interrupt`。服务重开恢复成功结果、标记中断且不自动重试。自定义端口统一加 `--port 端口`。

请在 Codex 中要求打开查询返回的 URL：`open_in_codex` 的 `placement: right`、`target.type: browser`。queued 仅表示排队，需读取内置浏览器中的实际表格才能记为通过。

## 共享业务层与存储

调用路径：React 面板 / MCP → `GET /api/status` → `src/business/index.ts` → SQLite。共享 schema 与 HTTP 客户端位于 `src/shared/`。MCP 是 stdio 适配器，查询和修改均调用独立服务，不另建数据库或启动后台服务。

业务层 `openBusiness(directory)` 暴露 `getSnapshot()`、`addSegment(text)`、`editSegment(id, text)`、`modifyBatch()`、`querySegments()`、`processScope()` 与 `close()`；数据库连接不对适配层开放。新目录自动创建可保存的空项目，已有目录恢复项目标识、创建时间、有序片段及文案。同一服务固定打开一个项目；`service-owner.sqlite` 的独占文件锁保证同一项目不能经不同端口重复打开，进程退出自动释放；更换项目须停止旧服务，再指定新目录启动。目录由用户在 Codex 中明确指定，面板仅在视频导入对话框接收用户明确指定的单个视频路径，不提供目录扫描或任意文件读取。

点击「新增口播片段」创建空文案片段，单击口播文案（或聚焦后按 Enter / F2）进入编辑。Enter 换行，Ctrl／⌘+Enter 或「保存修改」保存；失焦不提交。Esc 在未改动时退出，已有改动时提示放弃。切换片段先保存，失败保留草稿。网络中断或超时可能使结果未知，此时核对表格后再操作，不自动重发新增请求。

面板由 `src/panel/project-editing.ts` 统一管理文案、画面素材与导出设置的编辑过程。文案及画面素材保存后释放修改权；导出设置连续自动保存，关闭设置时释放。项目刷新与编辑共用响应归属判断，迟到查询、旧保存结果和旧连接事件不能覆盖后续编辑；离页或卸载后才取得的修改权也立即释放。单次保存可能先关闭编辑连接再返回提交结果，面板会等待保存响应，不将正常关闭误报为失败。断线取消未提交输入，已提交但结果未知的请求不自动重试。

表格勾选用于明确操作目标，可删除勾选片段；只勾选一个片段时可用「项目顺序上移／下移」调整真实项目顺序。文案筛选和序号／文案表头排序只改变视图，数字序号仍表示完整项目中的顺序；删除后剩余片段重新连续编号。筛选隐藏的勾选仍保留，界面显示包含隐藏项的总勾选数。「粘贴多行文案」输入区按每个非空行新增一个片段，忽略空白行，支持 LF、CRLF 和 CR 换行。所有操作按稳定 UUID 定位。

表格通过独立的 `POST /api/table-session` 长连接维护临时勾选，`POST /api/table-selection` 同步身份集合；不占用修改权。关闭、刷新或断开表格后清除该连接的选择，重新连接从空选择开始。同步失败会显示断开并清空勾选，可手动重新连接。多个表格的选择独立，MCP 必须指定 `tableId` 消除歧义。

`POST /api/edit-session` 取得一次用户编辑的修改权并保持 NDJSON 长连接，首行返回凭据与最新快照。保存请求须携带 `X-Edit-Token`；取消通过 `POST /api/edit-session/release` 释放，连接断开也会释放。迟到释放只作用于对应凭据。`POST /api/segments/add` 仅接受 `{ text }`，`POST /api/segments/edit` 仅接受 `{ id, text }`；身份为 UUID，项目顺序持久化且独立于表格显示。所有变更经业务层同一 SQLite 事务提交入口，提交完成才返回快照；后续素材元数据、设置和任务应沿用该入口，不能另建表格存储或任意 SQL／状态修改接口。

```text
指定的本地项目目录/
  clapgrid.sqlite       # 结构化记录；运行时可能有 -wal、-shm 文件
  service-owner.sqlite  # 服务独占锁，不包含业务记录
  media/                # 视频原件副本、VP8 WebM 预览及 PNG 缩略图
  service.log           # 后台进程启动日志
```

媒体字节不存入 SQLite；媒体元数据、片段素材归属及画面编排独立持久化，文件名由素材 UUID 派生。数据库和媒体目录均不在静态 HTTP 白名单中；仅通过素材身份与固定媒体路由提供预览，支持字节范围请求及图片原件查看，不暴露任意路径。运行配置、密钥不属于项目记录。面板不是数据源，空片段集合由业务层返回。

服务仅绑定 `127.0.0.1`，检查 Host 与 Origin，不开放跨域读取；写入接口只接受 JSON 并严格校验业务字段。存储入口拒绝符号链接和多硬链接文件，启动器日志也使用相同检查。不提供任意业务状态修改、SQL 或文件读写 API；同机进程仍可访问服务，不是多用户或恶意本机进程隔离机制。

## 画面素材与编排

每行通过素材缩略图与数量打开本句悬浮托盘，从项目素材选取，或填写本地 PNG、JPEG、视频的绝对路径导入并加入本句。图片保持原生身份和透明通道；视频生成静音 WebM 原件预览。仅复制用户指定的普通文件，继续拒绝符号链接、多硬链接、播放列表和网络引用，不扫描相邻目录。托盘区分图片、视频和名称，可查看图片原件、播放视频原件、重命名和移出本句；移出及删除片段保留项目素材，同一原件可供多句复用。重命名更新项目中的素材名称，所有引用同步显示；不移动或改写原件，旧名称变化时拒绝覆盖。

托盘只确定本句使用哪些素材，添加不自动均分时长或贯穿整句。agent 根据本句文案、画面说明和素材决定背景、透明角色等叠加内容的位置、尺寸、层级及出现时间。页面不提供人工时间线、起点、图层或拖动缩放控件。用户通过对话提出修改，审阅“片段合成预览”。相关内容或编排变化后旧预览显示待更新。

制作入口：`clapgrid_import_material({ sourcePath })` 导入原生素材；`clapgrid_modify` 的 `{ kind: "materials", expected, assetIds }` 确认本句归属。先生成有效配音，再调用 `clapgrid_visual_context({ segmentId })` 取得当前输入及精确解码时长；提交 `{ kind: "composition", expected, plan: { duration, layers } }`。每层明确 `assetId`、`role`（background／overlay）、`from`、`to`、`start`（秒）、`x`、`y`、`width`、`height`（相对 1920 × 1080 画布）、`z`（背景为 0，叠加为正数）。背景须连续覆盖整句，本句全部素材须进入编排；同一素材可在多个区间重复引用。编排时长须与查询得到的有效配音时长一致。

页面图层支持逐帧动画背景和透明叠加。agent 在用户工作空间中编写含 `index.html` 的目录，通过 `clapgrid_import_page({ sourceDirectory })` 导入为 `pages/<SHA-256>/` 内的不可变副本，返回 `pageId`；同一内容重复导入复用身份。源路径须为工作空间内绝对路径；显式项目入口以项目父目录作为工作空间边界。页面只接受 html/js/mjs/css/json/svg/png/jpg/jpeg/webp/woff2/ttf/otf，最多 256 个文件、32 MiB，拒绝符号链接、多硬链接和目录外引用。修改后重新导入并保存新编排，旧预览自动待更新。

`clapgrid_visual_context` 还返回 `page.canvas`（1920×1080）、`page.fps`、`page.assetUrls`（`/assets/<assetId>`）及上限。页面暴露 `window.DUR`（秒）、`window.render(t)` 和 `window.READY = true`，可选 `TEXTS(t)`；字体、图片及素材应在 READY 前加载完毕（最多等待 120 秒）。`render(t)` 以图层 from 为零点，必须独立确定，不依赖上一帧、当前时间或无种子随机数；DUR 与 to-from 的误差不超过 1 ms。视口按 1920×width、1080×height 四舍五入到最近偶数（至少 2 px），设备像素比 1，以 innerWidth/innerHeight 布局。帧数为 round(DUR×fps)，不足一帧会明确失败。

页面图层为 `{ kind: "page", pageId, assetIds, role, from, to, x, y, width, height, z }`，没有 start。assetIds 只声明本句素材，并计入“本句全部素材进入编排”的校验；页面只能读取自身文件和声明的素材。页面背景同样连续覆盖整句。素材图层的 kind 可为 asset，省略仍兼容旧编排。页面渲染失败会在任务问题中指明片段与原因，不产生成片。页面应将所有依赖保存在目录内，外网、任意本地路径、WebSocket、WebRTC、Worker 和嵌入框架均被拒绝；仅输出画面，字幕继续按导出设置统一烧录。固定浏览器、软件渲染和双页面实例产生 FFV1 中间视频，共用预览及导出滤镜链。组件来源见 [Linux 组件](docs/linux-components.md)，决策见 [ADR0015](docs/adr/0015-page-rendering.md)。

`clapgrid_preview_segment({ segmentId })` 受理真实合成，使用 `clapgrid_visual_previews` 查询终态；只有 `succeeded` 且 `current: true` 表示当前输入的可审阅结果。任务期间沿用项目占用、取消、清理与中断恢复规则，取消使用 `clapgrid_cancel_export`。片段预览和全片导出共用渲染器执行已保存编排，真实混合透明通道，短视频冻结末帧；缺失或过期编排明确失败。普通制作请求包含素材准备、agent 编排和合成预览，明确“先准备素材”时停在准备阶段。

HTTP 对应 `POST /api/page/import`、`POST /api/codex/import-page`、`/api/material/rename`、`/api/codex/rename-material`、`/api/material/import`、`/api/codex/import-material`、`/api/segments/modify`、`/api/codex/modify`、`GET /api/visual-context/:segmentId`、`POST /api/visual-previews/submit` 和 `GET /api/visual-previews`。图片仅通过已登记身份的 `/api/media/:id/original` 查看，保留原始 MIME 与透明通道；视频不开放任意源文件路径。

旧单视频与多视频项目继续保留素材身份、关联、顺序和起点。既有旧单视频记录的导出保留原行为；今后经旧 video／videos 接口写入也会确认素材归属并清空编排，须由 agent 重新编排后制作；旧多视频不会再自动均分，需要 agent 确认素材并保存明确编排才能导出。旧记录未生成新编排时，页面显示等待 agent 编排，不把原件播放器当成片段合成结果。导入、关联和编排遵循同一修改权与完整 `expected` 快照核对；失败保留已提交状态，断线后查询确认，不自动重发未知写操作。

## 本机插件更新

更新已安装插件时先读[本机插件交付](docs/agents/plugin-delivery.md)，按实际安装来源执行更新，并依据运行时与协议是否相容选择面板快更新或完整更新。该文档统一维护命令、空闲条件、恢复位置及实际宿主验收步骤。

源码合并、安装完成与实际宿主加载分别报告；安装成功不能代替 MCP、服务和面板的实际验证。日常重开使用[打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)，更新后的验收仍按交付规程执行。

## 业务 MCP 与插件

```bash
npm run mcp
npm run plugin:build
```

`clapgrid_status` 返回相同的服务实例、修改权状态和项目快照；离线或协议不匹配返回 `isError`，不自动启动或重复业务请求。正式插件通过宿主聊天身份查询当前本地工作空间，自动发现其 `clapgrid/` 项目服务；不使用默认端口或 `CLAPGRID_SERVICE_URL`。宿主身份缺失、目录变化或服务实例不符时拒绝调用，要求关闭重开。

`clapgrid_modify` 接收 `{ changes: [...] }`，支持 `{ kind: "add", text }`、`{ kind: "edit", expected, text }` 、`{ kind: "delete", expected }`、`{ kind: "paste", text }` 和 `{ kind: "reorder", expectedIds, ids }`。重排要求 `expectedIds` 与最新项目身份顺序一致，`ids` 是全部片段身份的无重复排列；单次重排或粘贴在一个事务内提交。表格通过携带用户修改权的 `POST /api/segments/modify` 调用同一业务批处理。`expected` 必须是查询时取得的完整片段 `{ id, order, text, video }`。服务收到请求即尝试取得修改权；占用时返回冲突，不排队。取得修改权后逐项重读，变化返回 `changed` 和最新片段，已删除返回 `deleted`，成功返回 `applied`，存储异常返回 `failed`，并附分类汇总。各项独立提交，失败不撤销其他已完成项。网络中断可能已有部分提交，须先查询，不能盲目重发。

`clapgrid_query_segments` 接收 `{ scope }`。范围支持 `{ kind: "all" }`、`{ kind: "ids", ids }`、`{ kind: "query", textContains }` 或 `{ kind: "selected", tableId? }`，返回项目顺序下的片段快照、已连接表格及勾选。没有勾选或连接时，selected 返回 `availability: "unavailable"`；多个表格未指明连接时返回 `ambiguous`，两者都返回空目标，不扩展范围。

`clapgrid_process_segments` 接收 `{ scope, expected, action }`，其中 `expected` 是查询得到的完整片段快照数组，`action` 为 `{ kind: "edit", text }` 或 `{ kind: "delete" }`。取得修改权并接收完整请求后，服务在让出执行权之前固定目标身份；后续改选、筛选或表格断开不影响该操作。选择为空或有歧义会拒绝；新增目标缺少查询快照也拒绝，要求重新查询；明确身份和原条件命中的旧目标仍进入重读，逐项返回已删除或已变化信息。明确身份和条件查询在表格关闭后仍可用。批量配音使用明确范围；全片导出始终读取完整项目。

表格先取得修改权再打开编辑器，保存、Esc 取消或连接断开时释放。Codex 修改期间不能开始编辑；表格每秒查询共享状态，自动显示已完成修改。普通查询不占用修改权。普通修改权与配音任务锁独立；配音从受理前锁定项目至终态持久化，关闭表格、MCP 或编辑连接不会提前解锁。

插件源为 `plugins/clapgrid/`，含清单、stdio MCP 配置、`open-clapgrid` 技能。`plugin:build` 生成 **`dist/plugin/clapgrid/`**，打包服务、MCP 的依赖及面板，运行需要满足要求的 Node.js，视频功能另需上述 FFmpeg 组件。注册或安装时使用这个完整目录，源码模板本身不可直接安装。Linux 上构建的包会将 MCP 接到同一组件选择器；其他系统仍使用 Node 入口。插件 MCP 的 `cwd: "."` 由宿主相对于插件根目录解析。

将完整构建目录接入个人插件市场并安装后，在新会话使用已安装的 `open-clapgrid`，由 Codex 按[当前打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md)连接工作空间项目。`plugin:build` 只生成安装包；市场接入与安装使用实际宿主支持的方式并遵守宿主审批。安装后的技能发现和 MCP 加载需另行实测；从构建包执行协议测试不等同于宿主安装验收。

Linux 组件的准备步骤见[组件准备流程](plugins/clapgrid/skills/open-clapgrid/references/linux.md)，维护和来源见[组件说明](docs/linux-components.md)。查阅既往交付证据时使用 [#29](https://github.com/dulltackle/ClapGrid/issues/29)；其中安装命令、系统限制和未验证项仅对应当时版本，现行打开与更新按上述流程执行。

## 工作空间固定项目

日常打开由已安装的 `open-clapgrid` 按[打开流程](plugins/clapgrid/skills/open-clapgrid/SKILL.md#日常快速重开)处理：在线时使用 `clapgrid_prepare_panel` 返回的完整面板地址；首次打开或明确离线时进入组件准备、`open` 和独立 `workspace-status` 核对。项目固定在宿主工作空间的 `clapgrid/` 目录，不提供日常项目和端口选择。无本地工作空间时先选择或创建工作空间，不能使用插件安装目录代替。

服务通过系统分配端口，发布项目内的 `service.json` 供发现；数据库、媒体、配音及成片仍由同一个项目服务管理。表格保留完整 `/binding/…` URL，每个业务请求核对项目服务实例和聊天当前目录。工作空间改变后关闭旧面板并重新打开；旧项目任务继续，失效连接不自动重发制作请求。

此能力依赖宿主提供聊天请求元数据以及可运行的本地 `codex app-server`。绑定版已通过实际插件与业务 MCP 的打开、双向编辑和重开验证，具体边界见 [#42](https://github.com/dulltackle/ClapGrid/issues/42)。当前按宿主实际本地工作目录绑定；「移出桌面项目但保留 cwd」的禁用语义由 #48 后续处理。本文此前的 `--project` 与 `--port` 命令仅用于开发/历史服务维护，不是正式插件日常入口。

## 验证范围

自动化边界经确认：共享业务层公开接口、HTTP 接口、MCP 工具接口。测试使用临时 SQLite 和真实本机服务，MCP 使用 SDK 协议传输；面板单独在 Codex 内实际检查。执行记录见 [#16](https://github.com/dulltackle/ClapGrid/issues/16)。

自动化验证使用模拟供应商响应，不产生配音费用；导出测试执行真实本机媒体处理。项目编辑与保存验证见 [#17](https://github.com/dulltackle/ClapGrid/issues/17)。交替修改验证见 [#18](https://github.com/dulltackle/ClapGrid/issues/18)。片段组织与明确范围验证见 [#19](https://github.com/dulltackle/ClapGrid/issues/19)。Windows、macOS 安装与正式组件分发仍属于后续事项；Linux 的真实任务跨 Codex 退出及实际重启恢复已完成验证，见 [#26](https://github.com/dulltackle/ClapGrid/issues/26)。

实现参考：[AG Grid React 官方入门](https://www.ag-grid.com/react-data-grid/getting-started/)、[OpenAI 插件打包说明](https://developers.openai.com/plugins/build/plugins)。

本地视频验证见 [#20](https://github.com/dulltackle/ClapGrid/issues/20)。

## 单片段配音

在本机用户目录 `~/.config/clapgrid/.env` 配置 `TOKENDANCE_KEY`（Windows 为用户主目录下的 `.config/clapgrid/.env`）。文件由用户在项目之外创建并限制访问；服务不读取项目 `.env`，不把密钥写入项目或通过表格／MCP 返回。表格显示实际绝对路径和「已配置／未配置」。每次提交重新读取该文件，换密钥无需重建项目，不影响已有配音有效性。

统一音色提供 vivi 2.0（默认）、流畅女声、儒雅逸辰；统一语速默认 1.0 倍，可用范围 0.5～2.0 倍，以 0.01 倍递增。声音按项目保存，无逐片段覆盖、高级参数或自动生成。接口使用 `speechRate` 整数 -50～100，转换关系为 `1 + speechRate / 100`。供应商请求固定 TokenDance `seed-tts-2.0`、24 kHz MP3，音量省略以使用默认值。协议依据 [TokenDance 语音文档](https://tokendance.space/docs/protocol-ark-tts.md)。

单行「生成配音」先返回已受理和任务标识；查询到成功后才提供试听。任务期间禁用项目修改和追加生成，查询、视频预览及已有配音试听仍可用。输入快照、请求标识和任务结果保存到 SQLite。配音失败保留旧音频，未收到完整完成标志不发布部分音频；断流、网络异常和无法确认的服务结果显示「结果未知，可能已计费」。不会自动重试或切换供应商。进程中断后，重开把未完成任务标为未知，不再发起请求。

业务 MCP：

- `clapgrid_set_voice`：`{ speaker, speechRate }`，保存项目统一声音。
- `clapgrid_submit_speech`：`{ requestId, segmentId }`，一次操作固定 UUID；重发复用同一标识，只有用户明确的新生成才换新 UUID。返回 `accepted` 不是成功。
- `clapgrid_speech_status`：查询配置状态、统一声音、锁、任务和音频。按 `id` 或 `requestId` 查找原操作，音频 `url` 相对于本地服务地址。

表格提交前把请求标识保存到浏览器本地存储。提交未确认时，再点按钮会复用原标识核对，不会自动创建新的付费请求。验收证据及未验证项见 [#21](https://github.com/dulltackle/ClapGrid/issues/21)。

## 全片导出

表格的「导出全片」始终采用完整项目顺序，筛选、勾选不影响范围。用户或 Codex 正在编辑、或配音任务尚未结束时，直接拒绝导出，不创建导出任务，也不影响当前编辑或配音。受理后先返回任务标识，随后汇总片段视频、起点、有效配音及导出设置问题；校验失败不会跳片段或自动生成配音。校验到渲染、取消清理全程锁定项目，同项目重复提交返回正在执行的任务。

项目内部由 `project-access.ts` 统一管理普通修改权、配音及导出占用，写入与任务受理共用准入规则，表格状态和退出保护读取同一份占用状态。普通编辑与后台任务仍有区别：默认退出只保护后台任务。任务终态保存或必要清理失败时继续保持占用，清理完成且终态保存成功后才解锁。

画面从指定起点截取至配音结束，剩余画面不足时冻结末帧并提示；视频等比缩放留边、原声静音，片段直接拼接。字幕按项目字体字号整句烧录，支持中文自动换行和多行，不因长文案拒绝导出。媒体环境需 FFmpeg、ffprobe、Fontconfig，以及 ffv1、libvpx、libvorbis 和支持 `wrap_unicode` 的 libass/libunibreak。字幕排版使用 ASS，须显式开启 Unicode 换行（[FFmpeg 官方说明](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)）。

成片输出至项目 `exports/`，格式固定 1920×1080 MP4，编码及帧率使用当前设置。文件名包含时间及 UUID，每次生成新文件；表格显示位置并提供打开入口；内置浏览器以兼容的 WebM 预览播放，并提供原始 MP4 下载，预览保存在项目媒体目录。取消先显示「正在清理」，等待媒体进程结束和本次临时文件删除后才解锁。失败显示原因与能定位的片段，已有成片保留。清理或状态保存失败时保持锁定并显示原因，不能把未清理的文件当作已清理。

`src/business/export-files.ts` 集中管理一次导出的素材副本、临时目录、成片与预览的发布和清理，任务仍负责进度、终态保存及释放占用。部分发布失败只撤销本次成功发布的文件，目标冲突不会覆盖或删除原有文件；清理期间取消也会撤销本次成片与预览。两份产物已生成但成功状态未落盘时，项目保持锁定，文件不能通过导出入口读取；重开后清理本次产物并标记中断，不自动续导，历史成功成片保留。

- `clapgrid_submit_export` / `POST /api/exports/submit`：参数 `{}`，立即返回任务，`accepted` 不等于成功。
- `clapgrid_export_status` / `GET /api/exports`：查询任务、锁、完成片段数、问题、警告及成片位置；`output.url` 相对于服务地址。
- `clapgrid_cancel_export` / `POST /api/exports/cancel`：参数 `{ taskId }`，`cleaning` 不等于已取消，继续查询至终态。

新请求返回 `succeeded` 才确认成片可打开；请求断线时先查询任务，不自动重发。测试使用本机合成素材和模拟供应商音频，不产生配音费用；导出测试实际运行 FFmpeg。验证记录见 [#25](https://github.com/dulltackle/ClapGrid/issues/25)。服务退出与恢复见下一节；三平台宿主交付继续由 #27—#30 承接。


## 服务退出与中断恢复

使用 `npm run runtime -- start --project <目录>` 启动构建后的独立服务。相同项目和端口复用原实例；其他项目或同项目的其他端口不会接管已有服务。关闭表格、MCP 或启动命令不会停止已受理任务。重开先查询任务，不自动重新提交。表格每秒读取服务状态，断连时显示连接失败，重连后读取同一项目的持久化任务。

- `npm run runtime -- stop --project <目录>`：有任务时返回 `kept`，默认保持服务；无任务时开始退出。
- 仅明确选择“中断任务并退出”时使用 `npm run runtime -- stop --project <目录> --interrupt`。自定义端口须附加原 `--port`。
- `stopping` 表示正在停止，随后查询旧实例离线。SIGTERM/SIGINT 也遵守有任务默认保持规则；表格没有配音取消按钮。

退出请求绑定查询到的服务实例，旧实例请求不能停止后来启动的实例。导出停止等待媒体进程结束和清理，本次半成品删除，已有成片保留。重新打开显示“已中断”，不会自动续导；用户再次导出时读取最新内容从头开始。配音成功音频保留，已发出但无最终结果的任务提示可能已计费，尚未发送的任务明确说明，不自动重试。

服务通过独立媒体守护进程运行 FFmpeg/ffprobe；服务崩溃导致 IPC 断开，守护进程终止媒体子进程并等待 `close`，然后释放 `media-owner.sqlite`。新服务取得项目锁和媒体锁后才恢复业务状态。`media-active.json` 记录正在运行的媒体守护进程；守护进程本身异常且无法确认子进程停止时保留文件并拒绝恢复，不仅凭 PID 或锁文件推断已安全结束。Linux 使用本次开机标识区分关机遗留；其他平台遇到守护进程异常遗留时采取保守拒绝恢复，关机恢复仍需后续平台交付完善和实测。

跨退出验收记录见 [#26](https://github.com/dulltackle/ClapGrid/issues/26)。自动化中的模拟供应商响应不算真实配音验收，关闭启动命令也不等于完全退出 Codex。

## 自动检查与本地复现

日常检查先读[检查与验收](docs/agents/verification.md)：准备环境、选择定向或完整检查，并按实际运行范围记录结果。该文档统一维护常用命令、CI 验收规则和性能结论的适用范围；命令定义以 `package.json` 为准。

排查 CI 时查看[原生 CI 说明](docs/testing/native-ci.md)中的执行接线与原始报告位置；旧测试机制的退出和产品保障承接见 [#200](https://github.com/dulltackle/ClapGrid/issues/200)。插件安装与实际宿主交付另按[本机插件交付](docs/agents/plugin-delivery.md)核对。
