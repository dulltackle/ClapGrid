# ClapGrid

通过 Codex 右侧表格组织口播视频。产品契约见 [MVP.md](MVP.md)，术语见 [GLOSSARY.md](GLOSSARY.md)。

当前已支持本地项目创建／重开、口播片段新增、文案编辑、删除、重排、多行粘贴、明确范围操作、自动保存、表格与 Codex 交替修改、本地视频导入／复用／预览和业务 MCP。现已支持 TokenDance 配音、试听、带字幕全片导出和独立后台任务。Linux 正式插件提供组件准备入口；三平台完整交付仍需各自验收。

## 运行条件

- Node.js **22.13 以上**及 npm；本轮验证 Node.js 22.23.3、Ubuntu 24.04。
- 视频处理要求本机 `ffmpeg` 与 `ffprobe` 在 PATH 中，FFmpeg 含 `libvpx` 编码器；本轮验证 FFmpeg 6.1.1。Linux 正式插件可由 Codex 经宿主许可执行组件安装；开发模式缺失时明确失败。正式产品 Linux 验证由 #29 跟进，原型干净桌面首装保留在 #15。
- 采用 Node 内置 `node:sqlite`，无需单独编译 SQLite 扩展；Node 22 会输出实验性 API 警告。运行时要求与版本锁定记在 `package.json` 和 `package-lock.json`。
- Codex 桌面端须有右侧内置浏览器与宿主命令执行能力。外部浏览器仅可辅助开发，不能替代右侧验收。
- 首次 `npm ci` 需要联网。宿主限制安装、文件写入或后台启动时遵守其审批；拒绝后停止，不改变安全配置或替换执行路径。

## 开发与构建

在仓库根目录执行：

```bash
npm ci
npm run dev -- --project /绝对路径/验证项目
```

开发模式在 `http://127.0.0.1:48762` 同源提供 Vite 页面与 API。修改后刷新页面；服务端修改需重新运行。开发模式是前台进程，Ctrl+C 正常停止。

```bash
npm run typecheck
npm test
npx tsx --test tests/business.test.ts
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

点击「新增口播片段」创建空文案片段，双击文案单元格（或选中后按 Enter）编辑；Enter 或离开单元格完成编辑并自动保存，Esc 取消未提交输入。保存期间暂停新的编辑，成功后显示「已保存」；失败显示「保存失败」，表格继续显示业务层已提交内容。未提交的输入不承诺恢复。网络中断或超时可能使结果未知，此时核对表格后再操作，不自动重发新增请求。

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

媒体字节不存入 SQLite；视频元数据保存在独立素材表中，文件名由素材 UUID 派生，片段只记录素材身份及起点。数据库和媒体目录均不在静态 HTTP 白名单中；仅通过素材身份与固定 preview／thumbnail 路由提供预览，支持字节范围请求，不暴露原件下载或任意路径。运行配置、密钥不属于项目记录。面板不是数据源，空片段集合由业务层返回。

服务仅绑定 `127.0.0.1`，检查 Host 与 Origin，不开放跨域读取；写入接口只接受 JSON 并严格校验业务字段。存储入口拒绝符号链接和多硬链接文件，启动器日志也使用相同检查。不提供任意业务状态修改、SQL 或文件读写 API；同机进程仍可访问服务，不是多用户或恶意本机进程隔离机制。

## 本地视频

点击「导入本地视频」，填写用户指定的文件绝对路径，再点击「导入并复制」。来源可以在项目外；只处理该文件，拒绝符号链接、多硬链接、目录、播放列表和不支持的媒体。不会扫描相邻目录或读取媒体内的网络引用。读取后复制到项目，完整解码校验视频画面，再生成静音 VP8 WebM 预览与 PNG 缩略图；所有步骤完成才发布素材。较长视频可能需要等待，取消或连接断开会中止未完成导入，仅清理本次未提交的文件。服务崩溃可能留下未登记文件，本事项不增加通用素材清理。

每行「关联／更改」选择已有素材并填写播放起点（秒）；同一素材可以用于多个片段。起点须是有限数字、大于等于零且严格小于视频画面的时长，不能用较长音轨的时长放宽边界。关联与起点保存前重新验证项目副本是否可解码；失败保留原值。选择「解除关联」只清除片段关系，替换与删除片段也保留原有素材。点击缩略图打开播放器，从已保存起点播放静音预览。

导入对话框及关联编辑器从打开到保存／取消持有用户修改权；MCP 导入在整个复制、校验及预览生成期间持有 Codex 修改权。查询和已有预览播放仍可用，冲突立即拒绝，不排队。关联变化也计入 `expected` 快照核对，旧查询不能覆盖新关联。重开项目恢复素材与起点，后续操作使用项目副本，源文件变化不影响它。

`clapgrid_import_video({ sourcePath })` 仅用于用户明确授权的具体来源，返回独立的 `asset` 及项目状态；调用方不得猜测或扫描未授权路径。`clapgrid_modify` 新增 `{ kind: "video", expected, assetId, start }`：关联／替换素材、保留同一身份设置起点，或 `assetId: null` 解除关联。`start` 单位为秒，解除时传 `0`。表格通过 `/api/video/import` 和 `/api/segments/modify` 使用相同规则。

## 本机插件更新

Git 合并只更新源码；已安装插件和后台服务由独立的交付流程更新。执行 `npm run plugin:update -- --revision <目标提交> --marketplace-root <本地市场根目录> --cache-root <插件缓存根目录> --workspace <工作空间> --thread <宿主聊天ID>`，从干净提交构建、备份和安装，再重启空闲服务。已有任务或编辑时停止更新并保留任务；失败返回备份位置与恢复结果。

安装完成仍需重载宿主并核对实际 MCP、服务和面板。`npm run plugin:verify -- ...` 在证据缺失、超过 5 分钟或版本不一致时退出 2。完整步骤及证据格式见 [本机插件交付](docs/agents/plugin-delivery.md)。面板“连接诊断”显示实际加载版本；版本不一致时先更新再重新打开。

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

将构建目录接入个人插件市场并安装后，在新会话使用 `open-clapgrid`，由 Codex 检查组件、查询／启动服务、打开右侧面板并查询 MCP。本仓库不自动写入个人市场、不更改用户 Codex 安全策略。安装后的技能发现和 MCP 加载需另行实测；从构建包执行协议测试不等同于宿主安装验收。Linux 的组件方案、正式安装步骤、实测版本及尚未通过的桌面验收见 [Linux 正式插件交付](docs/validation/issue-29/README.md)。

## 工作空间固定项目

正式打开入口为 `runtime open --workspace <宿主当前目录> --thread <宿主聊天ID>`，随后独立执行相同参数的 `workspace-status`。入口交叉核对公开 `codex app-server` 的 `thread/read`，自动创建或恢复固定 `clapgrid/` 目录，不提供日常项目和端口选择。无本地工作空间时先选择或创建工作空间，不能使用插件安装目录代替。

服务通过系统分配端口，发布项目内的 `service.json` 供发现；数据库、媒体、配音及成片仍由同一个项目服务管理。表格保留完整 `/binding/…` URL，每个业务请求核对项目服务实例和聊天当前目录。工作空间改变后关闭旧面板并重新打开；旧项目任务继续，失效连接不自动重发制作请求。

此能力依赖宿主提供聊天请求元数据以及可运行的本地 `codex app-server`。绑定版已通过实际插件与业务 MCP 的打开、双向编辑和重开验证，具体边界见 [#42 记录](docs/validation/issue-42/README.md)。当前按宿主实际本地工作目录绑定；「移出桌面项目但保留 cwd」的禁用语义由 #48 后续处理。本文此前的 `--project` 与 `--port` 命令仅用于开发/历史服务维护，不是正式插件日常入口。

## 验证范围

自动化边界经确认：共享业务层公开接口、HTTP 接口、MCP 工具接口。测试使用临时 SQLite 和真实本机服务，MCP 使用 SDK 协议传输；面板单独在 Codex 内实际检查。执行记录见 [工程骨架验证](docs/validation/issue-16.md)。

自动化验证使用模拟供应商响应，不产生配音费用；导出测试执行真实本机媒体处理。项目编辑与保存验证见 [#17 验证记录](docs/validation/issue-17.md)。交替修改验证见 [#18 验证记录](docs/validation/issue-18.md)。片段组织与明确范围验证见 [#19 验证记录](docs/validation/issue-19.md)。Windows、macOS 安装与正式组件分发仍属于后续事项；Linux 的真实任务跨 Codex 退出及实际重启恢复已完成验证，见 [#26 验证记录](docs/validation/issue-26.md)。

实现参考：[AG Grid React 官方入门](https://www.ag-grid.com/react-data-grid/getting-started/)、[OpenAI 插件打包说明](https://developers.openai.com/plugins/build/plugins)。

本地视频验证见 [#20 验证记录](docs/validation/issue-20.md)。

## 单片段配音

在本机用户目录 `~/.config/clapgrid/.env` 配置 `TOKENDANCE_KEY`（Windows 为用户主目录下的 `.config/clapgrid/.env`）。文件由用户在项目之外创建并限制访问；服务不读取项目 `.env`，不把密钥写入项目或通过表格／MCP 返回。表格显示实际绝对路径和「已配置／未配置」。每次提交重新读取该文件，换密钥无需重建项目，不影响已有配音有效性。

统一音色提供 vivi 2.0（默认）、流畅女声、儒雅逸辰；统一语速默认 1.0 倍，可用范围 0.5～2.0 倍，以 0.01 倍递增。声音按项目保存，无逐片段覆盖、高级参数或自动生成。接口使用 `speechRate` 整数 -50～100，转换关系为 `1 + speechRate / 100`。供应商请求固定 TokenDance `seed-tts-2.0`、24 kHz MP3，音量省略以使用默认值。协议依据 [TokenDance 语音文档](https://tokendance.space/docs/protocol-ark-tts.md)。

单行「生成配音」先返回已受理和任务标识；查询到成功后才提供试听。任务期间禁用项目修改和追加生成，查询、视频预览及已有配音试听仍可用。输入快照、请求标识和任务结果保存到 SQLite。配音失败保留旧音频，未收到完整完成标志不发布部分音频；断流、网络异常和无法确认的服务结果显示「结果未知，可能已计费」。不会自动重试或切换供应商。进程中断后，重开把未完成任务标为未知，不再发起请求。

业务 MCP：

- `clapgrid_set_voice`：`{ speaker, speechRate }`，保存项目统一声音。
- `clapgrid_submit_speech`：`{ requestId, segmentId }`，一次操作固定 UUID；重发复用同一标识，只有用户明确的新生成才换新 UUID。返回 `accepted` 不是成功。
- `clapgrid_speech_status`：查询配置状态、统一声音、锁、任务和音频。按 `id` 或 `requestId` 查找原操作，音频 `url` 相对于本地服务地址。

表格提交前把请求标识保存到浏览器本地存储。提交未确认时，再点按钮会复用原标识核对，不会自动创建新的付费请求。验收证据及未验证项见 [#21 验证记录](docs/validation/issue-21.md)。

## 全片导出

表格的「导出全片」始终采用完整项目顺序，筛选、勾选不影响范围。用户或 Codex 正在编辑、或配音任务尚未结束时，直接拒绝导出，不创建导出任务，也不影响当前编辑或配音。受理后先返回任务标识，随后汇总片段视频、起点、有效配音及导出设置问题；校验失败不会跳片段或自动生成配音。校验到渲染、取消清理全程锁定项目，同项目重复提交返回正在执行的任务。

项目内部由 `project-access.ts` 统一管理普通修改权、配音及导出占用，写入与任务受理共用准入规则，表格状态和退出保护读取同一份占用状态。普通编辑与后台任务仍有区别：默认退出只保护后台任务。任务终态保存或必要清理失败时继续保持占用，清理完成且终态保存成功后才解锁。

画面从指定起点截取至配音结束，剩余画面不足时冻结末帧并提示；视频等比缩放留边、原声静音，片段直接拼接。字幕按项目字体字号整句烧录，支持中文自动换行和多行，不因长文案拒绝导出。媒体环境需 FFmpeg、ffprobe、Fontconfig，以及 ffv1、libvpx、libvorbis 和支持 `wrap_unicode` 的 libass/libunibreak。字幕排版使用 ASS，须显式开启 Unicode 换行（[FFmpeg 官方说明](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)）。

成片输出至项目 `exports/`，格式固定 1920×1080 MP4，编码及帧率使用当前设置。文件名包含时间及 UUID，每次生成新文件；表格显示位置并提供打开入口；内置浏览器以兼容的 WebM 预览播放，并提供原始 MP4 下载，预览保存在项目媒体目录。取消先显示「正在清理」，等待媒体进程结束和本次临时文件删除后才解锁。失败显示原因与能定位的片段，已有成片保留。清理或状态保存失败时保持锁定并显示原因，不能把未清理的文件当作已清理。

`src/business/export-files.ts` 集中管理一次导出的素材副本、临时目录、成片与预览的发布和清理，任务仍负责进度、终态保存及释放占用。部分发布失败只撤销本次成功发布的文件，目标冲突不会覆盖或删除原有文件；清理期间取消也会撤销本次成片与预览。两份产物已生成但成功状态未落盘时，项目保持锁定，文件不能通过导出入口读取；重开后清理本次产物并标记中断，不自动续导，历史成功成片保留。

- `clapgrid_submit_export` / `POST /api/exports/submit`：参数 `{}`，立即返回任务，`accepted` 不等于成功。
- `clapgrid_export_status` / `GET /api/exports`：查询任务、锁、完成片段数、问题、警告及成片位置；`output.url` 相对于服务地址。
- `clapgrid_cancel_export` / `POST /api/exports/cancel`：参数 `{ taskId }`，`cleaning` 不等于已取消，继续查询至终态。

新请求返回 `succeeded` 才确认成片可打开；请求断线时先查询任务，不自动重发。测试使用本机合成素材和模拟供应商音频，不产生配音费用；导出测试实际运行 FFmpeg。验证记录见 [#25 验证记录](docs/validation/issue-25.md)。服务退出与恢复见下一节；三平台宿主交付继续由 #27—#30 承接。


## 服务退出与中断恢复

使用 `npm run runtime -- start --project <目录>` 启动构建后的独立服务。相同项目和端口复用原实例；其他项目或同项目的其他端口不会接管已有服务。关闭表格、MCP 或启动命令不会停止已受理任务。重开先查询任务，不自动重新提交。表格每秒读取服务状态，断连时显示连接失败，重连后读取同一项目的持久化任务。

- `npm run runtime -- stop --project <目录>`：有任务时返回 `kept`，默认保持服务；无任务时开始退出。
- 仅明确选择“中断任务并退出”时使用 `npm run runtime -- stop --project <目录> --interrupt`。自定义端口须附加原 `--port`。
- `stopping` 表示正在停止，随后查询旧实例离线。SIGTERM/SIGINT 也遵守有任务默认保持规则；表格没有配音取消按钮。

退出请求绑定查询到的服务实例，旧实例请求不能停止后来启动的实例。导出停止等待媒体进程结束和清理，本次半成品删除，已有成片保留。重新打开显示“已中断”，不会自动续导；用户再次导出时读取最新内容从头开始。配音成功音频保留，已发出但无最终结果的任务提示可能已计费，尚未发送的任务明确说明，不自动重试。

服务通过独立媒体守护进程运行 FFmpeg/ffprobe；服务崩溃导致 IPC 断开，守护进程终止媒体子进程并等待 `close`，然后释放 `media-owner.sqlite`。新服务取得项目锁和媒体锁后才恢复业务状态。`media-active.json` 记录正在运行的媒体守护进程；守护进程本身异常且无法确认子进程停止时保留文件并拒绝恢复，不仅凭 PID 或锁文件推断已安全结束。Linux 使用本次开机标识区分关机遗留；其他平台遇到守护进程异常遗留时采取保守拒绝恢复，关机恢复仍需后续平台交付完善和实测。

跨退出验收记录见 [#26 验证记录](docs/validation/issue-26.md)。自动化中的模拟供应商响应不算真实配音验收，关闭启动命令也不等于完全退出 Codex。

## 自动检查与本地复现

使用 `.node-version` 中固定的 Node 版本，执行 `npm ci` 后运行 `npm run check`。
这一入口与推送、PR 和手动触发的「自动检查」工作流一致，依次执行现有的
`npm run typecheck`、`npm test`、`npm run build`；任一项失败最终退出码非零，
其余检查仍会执行，避免一个错误掩盖其他检查结果。测试文件串行执行，避免多个浏览器与媒体任务争抢资源。安装失败时 CI 直接失败，后续检查未执行。

CI 使用 Ubuntu 24.04、Node 22.23.3、Chrome for Testing 131.0.6778.204，
通过 `npm ci` 按 `package-lock.json` 安装依赖。媒体依赖使用 Ubuntu 24.04 的
APT 仓库安装 `ffmpeg`、`fontconfig`、`fonts-noto-cjk`（包含 libass 依赖）；
APT 安全补丁版本可能更新，每次运行记录实际包版本。浏览器路径由 `CHROME_BIN` 指定。
本地同样需要 FFmpeg/ffprobe、Fontconfig、Noto Sans CJK SC 字体及 Chrome/Chromium；
未安装浏览器的本地测试会明确跳过浏览器用例，不能视作这些用例通过。

每次运行保存 `logs/check/<时间>-<进程号>/` 下的原始命令日志与 `summary.json`。
测试原始日志保留测试计数、失败堆栈、跳过项和原因，摘要同时记录退出码与尚未执行的步骤。
CI 另外保留安装与环境日志，成功或失败均上传 14 天有效的日志 artifact，
名称包含 workflow run ID 和重跑次数，可与 Actions 运行页面和提交 SHA 对照。
取消作业或准备环境失败时，应结合 Actions 的 skipped/cancelled 状态判断未执行项，不能只看已有成功日志。

检查使用测试夹具和本地服务，不传入真实供应商凭据，也不发起收费供应商调用。
CI 证明可自动复现的代码行为；实际 Codex 宿主的安装、加载、重载与界面交互仍须另行保存真实宿主证据。
首期不配置提交钩子，也不修改远端分支保护。

验证失败传播时，在临时副本或隔离分支分别进行下列操作，每次仅保留一种故障并运行同一入口：

- 类型错误：新增 `src/ci-negative.ts`，内容为 `const failure: string = 1; export {};`。
- 测试失败：新增 `tests/ci-negative.test.ts`，用 `node:test` 和 `node:assert/strict` 断言 `1` 等于 `2`。
- 无效构建：在根目录 `index.html` 添加指向不存在的 `/src/ci-missing.ts` 的 module script。

分别核对对应步骤非零、入口非零和完整日志，保留真实 CI run 链接后撤销故障。
本地负向检查不能替代真实 CI 结果；验证分支不合并到交付分支。
