# ClapGrid

通过 Codex 右侧表格组织口播视频。产品契约见 [MVP.md](MVP.md)，术语见 [CONTEXT.md](CONTEXT.md)。

当前已支持本地项目创建／重开、口播片段新增与文案编辑、自动保存、表格与 Codex 交替修改和业务 MCP。配音、导出及三平台安装交付尚未实现或验收。

## 运行条件

- Node.js **22.13 以上**及 npm；本轮验证 Node.js 22.23.3、Ubuntu 24.04。
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

服务运行于独立进程，关闭面板或 MCP 不影响它。骨架无后台业务任务，停止前先查询并核对 PID，然后通过正常 SIGTERM/Ctrl+C 停止；尚未实现产品级任务退出与中断恢复协议。自定义端口统一加 `--port 端口`。

请在 Codex 中要求打开查询返回的 URL：`open_in_codex` 的 `placement: right`、`target.type: browser`。queued 仅表示排队，需读取内置浏览器中的实际表格才能记为通过。

## 共享业务层与存储

调用路径：React 面板 / MCP → `GET /api/status` → `src/business/index.ts` → SQLite。共享 schema 与 HTTP 客户端位于 `src/shared/`。MCP 是 stdio 适配器，查询和修改均调用独立服务，不另建数据库或启动后台服务。

业务层 `openBusiness(directory)` 暴露 `getSnapshot()`、`addSegment(text)`、`editSegment(id, text)` 与 `close()`；数据库连接不对适配层开放。新目录自动创建可保存的空项目，已有目录恢复项目标识、创建时间、有序片段及文案。同一服务固定打开一个项目；`service-owner.sqlite` 的独占文件锁保证同一项目不能经不同端口重复打开，进程退出自动释放；更换项目须停止旧服务，再指定新目录启动。目录由用户在 Codex 中明确指定，面板不接受任意文件路径。

点击「新增口播片段」创建空文案片段，双击文案单元格（或选中后按 Enter）编辑；Enter 或离开单元格完成编辑并自动保存，Esc 取消未提交输入。保存期间暂停新的编辑，成功后显示「已保存」；失败显示「保存失败」，表格继续显示业务层已提交内容。未提交的输入不承诺恢复。网络中断或超时可能使结果未知，此时核对表格后再操作，不自动重发新增请求。

`POST /api/edit-session` 取得一次用户编辑的修改权并保持 NDJSON 长连接，首行返回凭据与最新快照。保存请求须携带 `X-Edit-Token`；取消通过 `POST /api/edit-session/release` 释放，连接断开也会释放。迟到释放只作用于对应凭据。`POST /api/segments/add` 仅接受 `{ text }`，`POST /api/segments/edit` 仅接受 `{ id, text }`；身份为 UUID，项目顺序持久化且独立于表格显示。所有变更经业务层同一 SQLite 事务提交入口，提交完成才返回快照；后续素材元数据、设置和任务应沿用该入口，不能另建表格存储或任意 SQL／状态修改接口。

```text
指定的本地项目目录/
  clapgrid.sqlite       # 结构化记录；运行时可能有 -wal、-shm 文件
  service-owner.sqlite  # 服务独占锁，不包含业务记录
  media/                # 本地媒体文件的存储边界，骨架不导入或读取媒体
  service.log           # 后台进程启动日志
```

媒体字节不存入 SQLite；未来仅保存项目内相对路径及业务元数据。数据库和媒体目录均不在静态 HTTP 白名单中。运行配置、密钥不属于项目记录。面板不是数据源，空片段集合由业务层返回。

服务仅绑定 `127.0.0.1`，检查 Host 与 Origin，不开放跨域读取；写入接口只接受 JSON 并严格校验业务字段。存储入口拒绝符号链接和多硬链接文件，启动器日志也使用相同检查。不提供任意业务状态修改、SQL 或文件读写 API；同机进程仍可访问服务，不是多用户或恶意本机进程隔离机制。

## 业务 MCP 与插件

```bash
npm run mcp
npm run plugin:build
```

`clapgrid_status` 返回相同的服务实例、修改权状态和项目快照；离线或协议不匹配返回 `isError`，不自动启动或重复业务请求。默认连接 `http://127.0.0.1:48762`。修改端口时给 MCP 配置 `CLAPGRID_SERVICE_URL`，只接受 IPv4 本机 HTTP 地址。

`clapgrid_modify` 接收 `{ changes: [...] }`，支持 `{ kind: "add", text }`、`{ kind: "edit", expected, text }` 和 `{ kind: "delete", expected }`。`expected` 必须是查询时取得的完整片段 `{ id, order, text }`。服务收到请求即尝试取得修改权；占用时返回冲突，不排队。取得修改权后逐项重读，变化返回 `changed` 和最新片段，已删除返回 `deleted`，成功返回 `applied`，存储异常返回 `failed`，并附分类汇总。各项独立提交，失败不撤销其他已完成项。网络中断可能已有部分提交，须先查询，不能盲目重发。

表格先取得修改权再打开编辑器，保存、Esc 取消或连接断开时释放。Codex 修改期间不能开始编辑；表格每秒查询共享状态，自动显示已完成修改。普通查询不占用修改权。此修改权仅表示普通编辑，不承担后续配音或导出任务锁；后台任务必须使用独立生命周期，不能复用编辑连接的释放回调。

插件源为 `plugins/clapgrid/`，含清单、stdio MCP 配置、`open-clapgrid` 技能。`plugin:build` 生成 **`dist/plugin/clapgrid/`**，打包服务、MCP 的依赖及面板，运行只需满足要求的 Node.js。注册或安装时使用这个完整目录，源码模板本身不可直接安装。插件 MCP 的 `cwd: "."` 由宿主相对于插件根目录解析。

将构建目录接入个人插件市场并安装后，在新会话使用 `open-clapgrid`，由 Codex 检查组件、查询／启动服务、打开右侧面板并查询 MCP。本仓库不自动写入个人市场、不更改用户 Codex 安全策略。安装后的技能发现和 MCP 加载需另行实测；从构建包执行协议测试不等同于宿主安装验收。

## 验证范围

自动化边界经确认：共享业务层公开接口、HTTP 接口、MCP 工具接口。测试使用临时 SQLite 和真实本机服务，MCP 使用 SDK 协议传输；面板单独在 Codex 内实际检查。执行记录见 [工程骨架验证](docs/validation/issue-16.md)。

本次不调用在线配音、不执行导出。项目编辑与保存验证见 [#17 验证记录](docs/validation/issue-17.md)。交替修改验证见 [#18 验证记录](docs/validation/issue-18.md)。Windows、macOS 安装、正式组件分发与完全退出 Codex 后的真实任务继续执行，仍属于后续事项。

实现参考：[AG Grid React 官方入门](https://www.ag-grid.com/react-data-grid/getting-started/)、[OpenAI 插件打包说明](https://developers.openai.com/plugins/build/plugins)。
