# #42 工作空间绑定：宿主能力核验

记录日期：2026-10-04（America/Los_Angeles）。事项：[打开 ClapGrid 时自动绑定当前工作空间](https://github.com/dulltackle/ClapGrid/issues/42)。

**当前状态：绑定版已通过实际两端打开、双向编辑和重开；本轮修复了宿主核对期间断线导致会话残留的问题，修复版 `.3` 已安装并启动。全量测试 133 通过、1 跳过、0 失败；真实无有效本地目录场景仍未验证，`.3` 实际 MCP 重载及双端复核已通过，见文末。** 下文按发生顺序保留历史诊断与验收，不将历史的待安装、未实现状态当作当前状态。模拟 MCP 测试及构建成功不作为实际插件验收。

## 实际环境证据

| 项目 | 本轮实际观察 |
| --- | --- |
| 系统 | `uname -sr`：Linux 7.0.0-38-generic |
| 桌面版本 | `/usr/lib/chatgpt/resources/linux-package-metadata.json`：ChatGPT 26.930.31730，prod |
| Codex | `/usr/lib/chatgpt/resources/codex --version`：codex-cli 0.160.0 |
| Node | `node --version`：v22.23.3 |
| 当前工作空间 | 本聊天宿主 `environment_context.cwd`：`/home/forclaw/code/ClapGrid`；这是代理上下文，不证明业务 MCP 收到了同一身份 |
| 当前分支 | SPEC-41；不作为项目身份 |
| 已加载插件 | `/home/forclaw/.codex/plugins/cache/personal/clapgrid/0.1.0+codex.20261004022000` |
| 应有项目位置 | `/home/forclaw/code/ClapGrid/clapgrid/`；本轮未创建，未取得项目 ID 或制作任务 ID |
| 实际业务 MCP | 调用 `mcp__clapgrid__clapgrid_status({})` 返回 `isError: true`，正文为「ClapGrid 服务不可用或身份不匹配（http://127.0.0.1:48762）。请通过插件入口经宿主允许启动服务后重试。」；这不能区分离线和身份错误 |

沙箱的 `/proc` 仅能看到本次命令，故通过获准的只读宿主进程检查复核。发现 6 个 ClapGrid MCP 进程（PID 7985、540134、556599、599726、639495、657111），其命令均为 `/usr/bin/node <已加载插件>/dist/mcp/main.js`，工作目录及 `PWD` 均为上述插件缓存目录。限定读取的 `CODEX_THREAD_ID`、`CLAPGRID_SERVICE_URL` 和名称含 `WORKSPACE` 的环境变量均未出现。没有读取或保存其他环境变量值。未确认六个进程分别关联哪个聊天。

已安装 `.mcp.json` 使用 `bash scripts/runtime-linux.sh mcp`、`cwd: "."`，仅声明转发 `CLAPGRID_SERVICE_URL`、`CLAPGRID_RUNTIME_HOME`、`XDG_DATA_HOME`。代码 `src/mcp/main.ts` 在环境变量缺省时固定使用 48762；`src/mcp/server.ts` 当前业务接口不验证调用者的工作空间。

**结论只限上述证据：插件进程工作目录不是用户工作空间。环境变量未携带身份，不等于宿主协议没有身份能力。** 仍需通过实际加载的新诊断工具检查 MCP roots 和请求元数据键。

## 能力矩阵

| 需要的能力 | 已确认与缺口 |
| --- | --- |
| 当前本地工作空间 | 代理获得本聊天 cwd；尚未证明业务 MCP 可以得到当前聊天的权威工作空间。不能用插件 cwd、默认端口或任意单个 root 推断 |
| 对话身份 | 进程环境未发现 `CODEX_THREAD_ID`；实际调用元数据尚未观测，不认定不支持 |
| 面板关联 | 当前 `open_in_codex` 工具说明承诺默认在调用聊天打开浏览器面板；不承诺把聊天 ID 传给第三方页面或业务 MCP。未实际打开面板验证关联 |
| 工作空间变化 | 工具清单未暴露供 ClapGrid 订阅的专用变化通知；MCP roots 能力和 `list_changed` 的实际行为待测。二进制内出现协议字符串不能证明宿主实现并发送通知 |
| MCP 连接配置 | 已安装配置为插件级静态配置；没有找到本聊天可调用的每对话重配或热重载工具。不能把修改全局服务 URL 用作工作空间路由 |

官方 [MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) 描述 `cwd`、`env`、`env_vars` 以及桌面设置中的 Restart；它没有在该页确立当前对话工作空间、roots 变化或每对话动态路由契约。[插件打包文档](https://developers.openai.com/plugins/build/plugins) 描述插件清单与 MCP 打包方式；不能据此推断每次工具调用附带工作空间。

## 已交付的诊断入口

`clapgrid_host_context({})` 为公开只读运维工具，不连接业务 HTTP 服务、不创建项目、不发起制作。适用于实际加载的业务 MCP：

- 返回客户端声明的名称和版本、MCP 进程目录及请求 `_meta` 的键名；不回显任意元数据值或环境变量。
- 仅在客户端声明 roots 能力时发出 `roots/list`，最多等待 3 秒；区分 `unsupported`、`available`、`unavailable`。`available` 的空数组仅表示本次返回空列表。
- 返回 roots 的 URI 和可选名称，剔除 root 元数据；记录该 MCP 连接自启动以来收到的 roots 变化通知次数。计数不是工作空间修订号，也不证明变化通知实时或完整。
- `workspace: null`、`bindingReady: false` 明确表示诊断尚未建立绑定。即便返回一个 root，也不擅自赋予「当前对话工作空间」语义。

本轮构建目录：`dist/plugin/clapgrid/`。当前聊天工具清单仍为旧版本，不含此入口。需通过正常插件管理加载该构建并重载 MCP；若当前聊天无法更新工具，需在同一工作空间新开聊天继续核验。不能仅直接运行 STDIO 测试进程就记为实际宿主通过。

## 供后续事项使用的绑定契约（待实际宿主确认）

以下是实现必须满足的约束，**不是已经存在的宿主 API 或已经实现的协议**：

1. 绑定输入必须来自可验证的当前聊天工作空间；区分「无本地工作空间」「无法取得身份」及「目录不存在」。这三种状态均禁止启动或沿用其他项目。路径绝对化不能代替来源验证。
2. 工作空间按实际目录规范化，固定项目为其 `clapgrid/` 子目录；拒绝把该子目录的链接解析到其他工作空间。工作空间路径别名共享项目，不同检出目录独立，Git 分支不参与身份。
3. 打开结果至少核对规范工作空间、规范项目目录、持久项目 ID、服务实例 ID 和本机 URL。端口是位置，不是身份；发现记录不得成为无需核验的信任来源。
4. 表格与业务 MCP 每次业务调用携带或由可信连接确定同一绑定；服务在执行操作前校验身份，避免客户端「先查再写」之间地址被复用。失效连接禁止写入；不自动重发制作请求。
5. 对话仅用于关联面板和绑定有效期，不用于分项目。后续 #41 子事项需确认对话、面板和工作空间修订的可靠来源；无法关联时不猜测当前勾选。
6. 工作空间变化使当前聊天旧连接失效，旧项目任务继续。若宿主无法可靠通知，必须落实关闭重开与身份核对流程，不能仅在文档提示后继续沿用旧连接。
7. 无法证明前述输入与失效语义时，应保留能力缺口，不发布「自动绑定完成」，不退化为用户手选端口或项目目录。

## 后续实际验证步骤

1. 加载新构建后，在本工作空间调用实际 `clapgrid_host_context`，保存原始结构化结果、客户端版本和插件版本。检查 roots、请求元数据键名与进程目录；元数据键存在仍需另行确认语义，不能凭名称当权威身份。
2. 在实际无本地工作空间的聊天复测，区分不支持 roots 与空 roots；诊断本身不得创建目录或启动服务。
3. 在同一实际聊天改变工作空间，重查 roots 与通知计数；确认旧连接是否保留、更新或重建。新建连接计数归零并不证明未发生变化。
4. 核对实际面板与业务 MCP 的对话关联机制；若宿主没有可用契约，记录具体缺口后再决定适配方案。
5. 仅在完成上述核验后实现启动发现与业务身份保护，再按 #42 验收实际打开、读取、编辑、关闭重开及失败场景。真实制作和 #33 的导出锁验收不由本记录代替。

## 本轮自动化验证

- `npm run typecheck`：通过。
- `node --import tsx --test tests/mcp.test.ts`：3/3 通过。覆盖原有业务修改/读取与服务离线；诊断不支持 roots、根列表及变化通知、空列表、查询失败、任意元数据值不回显。诊断用例先失败后实现；模拟客户端只验证协议处理行为。
- `npm run plugin:build`：通过，保留现有前端大 chunk 警告。
- `npm test`：132 个测试，131 通过、0 失败、1 跳过（已有的「安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功」用例）；约 66 秒。跳过不记为通过。
- 按 implement 使用 open-code-review-delegate 完成只读独立审查，实际覆盖全部 3 个改动文件。发现客户端 Implementation 额外字段被回显，已改为只返回名称/版本，并先复现失败再修复；修复后重新通过类型检查、MCP 单文件 3/3 测试及插件构建。全量回归与该定向复验分别记录，不宣称修复后又跑了一次全量。
- `git diff --check`：通过。当前改动未提交，等待实际宿主诊断后继续 #42；没有修改、勾选或关闭 GitHub 事项。

未执行：新诊断入口的实际宿主调用；实际无工作空间、工作空间变化、面板关联；#42 所要求的自动绑定打开、读写及重开。这些均不勾选为通过，也不关闭 #42 或父事项 #41。

## 2026-10-04 安装更新纠正

用户报告已重载后，本聊天仍仅暴露原有 14 个业务工具。检查发现 `dist/plugin/clapgrid` 包含新诊断工具，但原已安装缓存不含该工具：上一轮仅构建，漏做了个人插件源更新及正式安装，不能要求仅重载就取得新功能。

本轮在用户此前同意加载诊断构建的授权下，完成以下操作：

- 将构建包清单的部署版本标为 `0.1.0+codex.issue42.20261004.1`（仅部署产物；仓库源清单不变，重新构建会覆盖此标记）。
- 将既有个人插件源备份到 `/tmp/clapgrid-42-plugin-backup-34e9v6il/clapgrid`，再复制构建包到 `/home/forclaw/plugins/clapgrid`。
- 经正常宿主审批执行 `codex plugin add clapgrid@personal --json`，确认返回版本 `0.1.0+codex.issue42.20261004.1`，安装路径 `/home/forclaw/.codex/plugins/cache/personal/clapgrid/0.1.0+codex.issue42.20261004.1`。
- 对照构建与新缓存 MCP 文件 SHA-256，确认一致；新缓存已包含 `clapgrid_host_context` 注册。

安装成功仍不等于当前聊天已加载新工具。需在这次安装之后重载 MCP；如当前聊天工具清单不刷新，在同工作空间新开聊天继续。实际宿主诊断结果仍待取得，自动绑定验收状态不变。

## 重载后的实际宿主结果

用户再次重载后，实际工具清单出现 `mcp__clapgrid__clapgrid_host_context`，调用成功。原始结构化结果见 [host-context-2026-10-04.json](host-context-2026-10-04.json)。本节取代上文「实际诊断尚未调用」的历史状态，不改变完整功能未实现的结论。

- 客户端为 `codex-mcp-client` 0.160.0，进程目录为新安装缓存 `0.1.0+codex.issue42.20261004.1`。
- `roots.state` 为 `unsupported`、`listChanged` 为 false：本次真实 MCP 连接未声明 roots 能力，因此没有发出 roots/list。不能将此解释为用户没有工作空间。
- 实际请求元数据键包括 `callId`、`itemId`、`plugin_id`、`progressToken`、`sessionId`、`threadId`、`windowId`、`x-codex-turn-metadata`。工具未回显元数据值，尚未把某个字段的值确认为绑定身份。
- 宿主自带 `codex-app-tools/server.mjs` 的只读代码检查显示，它接受 `threadId` 或 `x-codex-turn-metadata.thread_id` 等字段作为调用聊天身份。这是当前版本的实现证据，不是第三方插件稳定 API 承诺。

### 公开 app-server 读取候选

本地 `codex app-server generate-json-schema` 生成的 `ThreadReadParams` 接受 `threadId` 和 `includeTurns`；`Thread.cwd` 描述为 “Working directory captured for the thread.”。[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)说明 `thread/read` 读取存储的聊天，不恢复聊天或订阅事件；turn/start 的 cwd 覆盖可以成为后续轮次的默认设置。尚未确认独立 app-server 读取与桌面改变工作空间之间的实时一致性。

标准 daemon 控制 socket `/home/forclaw/.codex/app-server-control/app-server-control.sock` 不存在，未启动或重启 daemon。另经正常宿主审批运行独立的短生命周期 app-server，只发送 initialize、initialized、thread/read（includeTurns=false），未创建或恢复聊天、未发起模型调用，读完后结束探针进程。过滤输出如下：

```json
{"id":"01a105b2-1d4a-7f03-b0dd-a6bddbcc4f5c","cwd":"/home/forclaw/code/ClapGrid","ephemeral":false,"status":{"type":"notLoaded"}}
```

查询 ID 来自当前 shell 的 CODEX_THREAD_ID；本次证明实际本机存储可返回本聊天目录，未证明实际 MCP 元数据的 ID 值、工作空间切换同步、无本地工作空间的语义或多主机归属。`notLoaded` 是该独立进程所见状态，不代表桌面聊天空闲。

下一项实测是由用户在宿主改变本聊天的本地工作空间，再以相同聊天 ID 只读查询并与宿主上下文核对，随后切回。未完成该验证前，不把这个候选通道用作自动业务路由；也不以固定路径替代当前工作空间身份。

## 同一聊天移动到另一项目后的实测

用户通过宿主移动本聊天后，本轮 `environment_context.cwd` 变为 `/home/forclaw/tmp`，可写根同时保留 `/home/forclaw/code/ClapGrid`。后者仍可访问不能被解释为当前项目仍属于原工作空间。

通过同一短生命周期 app-server 只读查询得到：

```json
{"id":"01a105b2-1d4a-7f03-b0dd-a6bddbcc4f5c","cwd":"/home/forclaw/tmp","ephemeral":false,"status":{"type":"notLoaded"},"projectId":null}
```

聊天 ID 保持不变，返回 cwd 与本轮宿主上下文一致，证明这次移动后的新轮次可以从持久聊天读取到新目录。实际 MCP 诊断仍可调用，仍返回插件缓存目录、同一组元数据键，以及 roots unsupported。未取得 MCP 进程 ID，不能由此断言进程未重启。没有启动 `/home/forclaw/tmp/clapgrid` 或原项目的服务。

补充发现：实际已移动到项目后 `projectId` 仍为 null。因此该字段不能直接作为当前桌面是否有本地工作空间的判据。当前证据仅支持此次移动后新轮次的 cwd 更新，不覆盖移动到下一轮之前的窗口、临时聊天、远程执行环境或多根目录的主目录语义。

下一步由用户移回 ClapGrid 项目，核对同一 ID 的目录恢复；自动绑定实现应采用每次调用核对当前目录，而非缓存首次读到的目录，并对无法读取、目录不存在及绑定不符明确失败。

## 往返完成与绑定候选实现

用户移回 ClapGrid 后，同一聊天 ID 的 thread/read 再次返回 `/home/forclaw/code/ClapGrid`，与宿主上下文一致，projectId 仍为 null。已完成本次真实宿主往返核验；不将它扩大为其他版本、云端、远程机器或所有无工作空间场景均通过。

候选版本 `0.1.0+codex.issue42.20261004.2` 实现如下：

- 插件 `open` 接收当前宿主工作空间及聊天 ID，先通过公开 app-server thread/read 交叉核对，再在规范实际目录的 `clapgrid/` 建立或恢复项目；不默认采用 MCP 进程目录。缺参数、查询失败、无有效本地目录时不启动。
- 后台服务使用操作系统分配端口，并在持有原有单项目服务所有权期间发布 `clapgrid/service.json`。发现时只读 `/api/identity`，核对工作空间、项目目录、项目 ID 和实例 ID，再建立业务绑定。
- 表格 URL 使用 `/binding/<聊天ID.实例签名>`。业务和媒体请求核对签名及宿主当前目录；旧实例签名在新服务上无效，工作空间变化或宿主不可查询时拒绝。业务请求体接收结束后再次核对，避免慢请求沿用开始接收时的旧工作空间。
- 正式 MCP 不再使用固定 `CLAPGRID_SERVICE_URL`，逐调用取得宿主聊天 ID、读取当前目录、发现服务并连接对应项目。无法取得身份时不回退到默认端口。不自动启动或重发制作。
- `workspace-stop` 保留原有任务期间 kept、明确 interrupt 后停止的语义。后台任务不依赖表格或 MCP 进程。
- `CLAPGRID_CODEX_BIN` 是部署时可选的 Codex 可执行文件路径，默认从 PATH 查找 codex；不是项目或端口选择器。宿主 API 不可用时关闭连接，不退回猜测路径。

`tests/workspace-runtime.test.ts` 使用模拟 app-server 协议但真实打包启动器、HTTP 服务和 stdio MCP，覆盖固定目录、同路径别名、Git 分支切换复用、两个目录独立、默认端口占用时原服务保持、缺少聊天身份、无有效 cwd、旧工作空间拒绝及服务重启后保存结果/旧签名失效。该测试不代表实际宿主已加载绑定版，也不证明真实多检出目录、无工作空间聊天或新面板的全部验收通过。

### 绑定版实际安装尚未执行

诊断版已安装且实际调用成功；绑定版构建完成后，对「备份并覆盖个人插件源、codex plugin add 持久安装」的执行审批被自动审核拒绝。理由为配置/环境变更且认为用户未明确授权此安装副作用。本轮未执行该命令、未替换现有诊断版缓存，也未绕过拒绝。完成独立审查后需要用户明确批准将现有个人 ClapGrid 插件更新为此绑定版，方可继续实际两端读写验收。

## 独立审查后的修正与最终本地检查

独立只读审查指出三项问题，均已修正并增加打包链路回归：工作空间变化后关闭已有表格/编辑会话并释放修改权；停止服务也必须使用有效的聊天绑定；发现记录的端口被其他 HTTP 服务占用时，允许在原有项目所有权约束下重新启动并分配端口。复审未发现新增可行动问题，覆盖 20 个代码文件，另外排除 7 个测试/文档文件。

类型检查、插件构建和 `git diff --check` 通过。受影响的工作空间打包链路、编辑面板、服务测试共 6 项通过。最终全量执行共 134 项：132 通过、1 跳过、1 失败；失败为 420px 浮层测试的「查看详情不改变表格滚动位置」断言。未修改该测试或焦点/滚动实现，单独重跑 `tests/dialog-panel.test.ts` 后 1600px 与 420px 两项均通过。此记录保留全量首次失败，不将单独重跑表述为全量全绿；并发负载下的偶发原因尚未确定。

日志保存在本机 `/tmp/clapgrid-42-full3.log`、`/tmp/clapgrid-42-dialog-rerun.log` 和 `/tmp/clapgrid-42-build-final.log`。当前个人插件仍为诊断版 `.1`，候选绑定版 `.2` 尚待明确安装授权及真实宿主验收，未提交、推送或关闭事项。

## 用户授权后安装绑定版

用户明确允许将个人插件从 `.1` 更新为 `.2` 后，已备份原插件源至 `/tmp/clapgrid-42-before-binding-2v9ob9ha/clapgrid`，更新个人插件源并执行 `codex plugin add clapgrid@personal --json` 成功。安装结果版本为 `0.1.0+codex.issue42.20261004.2`，缓存路径为 `/home/forclaw/.codex/plugins/cache/personal/clapgrid/0.1.0+codex.issue42.20261004.2`。对构建目录的 20 个文件与安装缓存逐一比较 SHA-256，全部一致。

安装后立即调用当前聊天的 `clapgrid_host_context`，其 processDirectory 仍指向 `.1` 缓存；因此磁盘安装已完成，但此聊天仍运行旧 MCP。需宿主重载后再核验绑定版，不能将安装成功计为实际 MCP 已切换或两端验收通过。

## 绑定版实际宿主双端验收

用户重载后，实际 `clapgrid_host_context` 返回 `.2` 缓存目录，workspace 为 `/home/forclaw/code/ClapGrid`。roots 仍不支持；工作空间由请求聊天身份经公开 app-server 查询取得。diagnostic 的 bindingReady 为 false 表示诊断本身不建立服务绑定。

已安装插件 Linux check 成功。经宿主执行审批调用安装缓存内的 `open`，在 `/home/forclaw/code/ClapGrid/clapgrid` 首次创建项目并启动服务；随后独立 `workspace-status` 与实际加载的 `clapgrid_status` 均返回：

- 项目 ID：`cd43eb48-a982-4004-8bc1-989c6fba9b3a`。
- 实例 ID：`c77eec34-c05b-45fb-8f3a-6e86ac7fafe6`；PID：1194992；自动端口：34887。
- 数据库：`/home/forclaw/code/ClapGrid/clapgrid/clapgrid.sqlite`；媒体目录：同目录的 `media/`。
- 初始片段、素材及任务均为空。

open_in_codex 返回 queued，未将其算为成功；改由内置浏览器实际创建并读取完整绑定 URL，显示「本地服务已连接」「已保存」。面板连接诊断中的项目路径及实例与 MCP 一致。通过实际 `clapgrid_modify` 新增验收片段 `249c241c-ea53-4639-a796-72f3e1636227`，面板显示该文案；在面板双击文案并修改为「工作空间绑定验收：面板已修改，MCP 可读回。」，实际 MCP 随后读回同一片段及新文案。

关闭该内置浏览器标签后再次运行已安装插件 `open`，返回同一项目 ID、实例 ID、PID 和保存的片段；重新打开面板仍显示已修改文案、连接正常及已保存。截图见 [host-panel-reopened.png](host-panel-reopened.png)。为保留可复核现场，验收片段和服务保留；未生成配音或导出。

这次已验证实际安装插件与实际 MCP 的打开、读写和重开。尚未验证绑定版运行期间真实宿主切换后旧面板的拒绝行为，以及真实无本地工作空间入口；此前诊断版的 cwd 往返与模拟协议失败测试不替代这两项。

## 绑定版运行期间真实工作空间切换

用户将同一聊天移动至 `/home/forclaw/tmp` 后，实际 `.2` MCP 诊断立即读到新目录。未打开新项目时，`clapgrid_status` 返回当前工作空间服务不可用，实际 `clapgrid_modify` 的验收新增请求返回「当前工作空间的 ClapGrid 尚未打开」，且 `/home/forclaw/tmp/clapgrid` 尚不存在。

原面板显示「暂时无法读取口播片段」「服务连接失败」「勾选连接已断开」，新增禁用；原绑定 URL 的 `/api/status` 返回 409「当前工作空间已改变或无法核对，请关闭重开 ClapGrid。」原 `/api/identity` 仍返回 200 和原项目/实例，证明原服务保持在线。通过只读 SQLite 复核，原项目仍只有此前已保存的验收片段，没有跨工作空间拒绝探针片段。截图见 [host-panel-workspace-changed.png](host-panel-workspace-changed.png)。

随后经宿主审批通过已安装插件在当前 `/home/forclaw/tmp` 执行 open，自动创建独立 `/home/forclaw/tmp/clapgrid`，得到项目 `e86ceb27-a76b-4d16-89c4-e3201f2325e5`、实例 `01e8ca87-8a33-47e1-9d85-33e48382dbf9`、PID 1350480、端口 36695。独立 workspace-status 与实际 MCP 一致；新面板显示本地服务已连接、已保存、暂无口播片段，没有复用原项目片段。此为两个真实本地工作空间的隔离实测，不冒充同仓库不同检出目录测试或无本地工作空间测试。

## 移出桌面项目后的实测：现有契约存在缺口

用户执行「移出项目」后，桌面 `list_threads` 显示本聊天 projectId 为 null、归入普通 Tasks；cwd 仍是 `/home/forclaw/tmp`。实际 `.2` 的 `clapgrid_host_context` 也仍返回该目录，实际 `clapgrid_status` 继续连接项目 `e86ceb27-a76b-4d16-89c4-e3201f2325e5`。本轮只读诊断，未执行业务写入、启动或创建项目。

这证明桌面项目归属与执行工作目录是两个独立状态。现有实现只验证后者，无法满足「移出桌面项目即禁止连接」的语义。此前 app-server 的 projectId 在归属本地项目时也为 null，不能用该字段补判断；桌面内置 list_threads 能读取项目归属，但目前未确认第三方 MCP 可调用的对应接口。查阅官方 app-server 与插件 MCP 文档后，尚未找到可据以实现该校验的公开契约。

因此不得把这次「移出项目」记为「无本地工作空间拒绝」通过。若产品定义移出项目即无工作空间，此项实测失败；若允许无项目聊天使用宿主仍明确保留的本地 cwd，则此次仍属于有本地执行目录的场景，真正无本地工作空间仍未验证。需要先明确产品语义，不能自行用后一解释降低验收要求。issue #42 仍未提交、关闭或勾选完成。

## 2026-10-04 本轮收尾、独立审查及修复版

本节取代此前关于范围待澄清的当前结论。#42 最新正文明确：桌面移出项目但保留执行 cwd 的禁用语义已拆至 #48，不阻塞 #42；本事项按宿主实际本地工作目录绑定。无有效本地目录仍必须拒绝，不能退回插件目录。

本轮聊天为 `01a109d8-052b-7063-8b04-23e4acb6156f`，工作空间为 `/home/forclaw/code/ClapGrid`。实际 `clapgrid_host_context` 返回客户端 `codex-mcp-client` 0.160.0、插件缓存 `.2` 和正确工作空间；MCP roots 仍 unsupported。已安装入口的 Linux check、open 与独立 workspace-status 通过；恢复项目 `cd43eb48-a982-4004-8bc1-989c6fba9b3a`，实例 `8eec83dd-82e6-4fc8-89ac-5b859972e397`，端口 40989。实际面板将原验收片段改为「工作空间绑定验收：本轮面板修改，MCP 复核。」，实际 MCP 读回后将同一片段改为「工作空间绑定验收：面板与 MCP 本轮双向复核通过。」。面板观察到修改，关闭并经已安装入口重开后显示已连接、已保存及相同文案。全量测试并发运行期间曾观察到面板暂时显示连接失败，未据此重发写入；重新打开恢复，服务实例和数据保持不变。没有执行配音或导出。

### 独立审查与回归

按 implement 使用 open-code-review-delegate 安排一个只读子代理。OCR 选中的 19 个文件全部审查，0 跳过；另读测试与文档。发现宿主身份查询异步等待期间客户端断开后，HTTP 仍可能建立会话，错过已发生的 close 事件，导致编辑锁或表格会话残留。

在既有打包入口/HTTP 集成边界先加入延迟宿主查询并中止连接的回归，观察到失败：预期 modification 为 null，实际为 `{ owner: 'user' }`。修复为核对完成后先检查 response.destroyed，heartbeat 发现已销毁响应时执行会话清理。回归随后通过，并覆盖表格会话列表为空、后续正常编辑可用。只读复审 2/2 文件通过，没有新增可行动问题。

同时补齐真实临时 Git 仓库的 `git worktree add` 回归，确认同仓库不同检出目录独立；原工作空间路径别名、同目录切换分支仍复用原项目。宿主协议替身返回 cwd=null 时，首次 open 拒绝且 clapgrid/ 未创建；已有服务也不能继续访问。此为确定性集成证据，不能冒充真实宿主无目录场景。

- `npm run typecheck`：通过。
- 定向 workspace-runtime、mcp、service 测试：8/8 通过。
- `npm run plugin:build`：通过；仅保留既有前端大 chunk 警告。
- 最终 `npm test`：134 项，133 通过、0 失败、1 跳过，约 77 秒。跳过项为既有「安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功」。此前记录的 420px 滚动断言本轮通过。
- 日志：本机 `/tmp/clapgrid-42-disconnect-red.log`、`/tmp/clapgrid-42-disconnect-green.log`、`/tmp/clapgrid-42-current-targeted.log`、`/tmp/clapgrid-42-current-build.log`、`/tmp/clapgrid-42-current-full.log`。

### 修复版部署及剩余宿主验证

构建版本更新为 `0.1.0+codex.issue42.20261004.3`，个人插件源备份于 `/tmp/clapgrid-42-before-fix-scuzqhn7/clapgrid`。经宿主审批更新个人源并执行 `codex plugin add clapgrid@personal --json` 成功。安装缓存的 20 个文件与构建逐一比较 SHA-256，全部一致；备份的 `.2` MCP 产物与 `.3` MCP 字节一致（本轮修改位于 HTTP 服务）。

通过 workspace-stop 普通退出本轮无任务的旧服务，独立查询确认离线后，从已安装 `.3` open 恢复同一项目和文案。新实例为 `1a707939-d7d7-48e5-bad0-6969685c04a6`，PID 416567，端口 35699；独立 workspace-status 成功，实际面板显示已连接、已保存。截图见 [本轮重开面板](host-panel-current-reopened.png)。

安装器清理了 `.2` 缓存目录；当前聊天旧 MCP 进程随后返回服务不可用，不能把安装成功当作当前 MCP 已重载。已请求宿主重载，待实际 `clapgrid_host_context` 与业务调用复核 `.3`。真实宿主没有有效本地目录的入口仍未实测，保留未验证；#48 延期不能替代此场景。#33 真实配音期间导出锁也不在本轮验证范围内。未修改父事项 #41。


## 2026-10-04 用户重载后：.3 双端复核完成

用户确认已重载后，实际 `clapgrid_host_context` 返回缓存目录 `0.1.0+codex.issue42.20261004.3`、客户端 `codex-mcp-client` 0.160.0、workspace `/home/forclaw/code/ClapGrid`。实际 `clapgrid_status` 成功，项目 `cd43eb48-a982-4004-8bc1-989c6fba9b3a`、实例 `1a707939-d7d7-48e5-bad0-6969685c04a6` 与已运行面板一致。本节取代上节“等待重载”的状态。

实际 `.3` MCP 将已有验收片段 `249c241c-ea53-4639-a796-72f3e1636227` 修改为「工作空间绑定验收：.3 重载后 MCP 写入成功。」，返回 applied，真实面板同步显示该文案。随后在面板修改并保存为「工作空间绑定验收：.3 重载后面板与 MCP 双向复核通过。」，实际 MCP 读回相同文案，修改权已释放。

再次运行已安装 `.3` 的 open，关闭并重开内置浏览器面板，随后独立 workspace-status 成功。项目、实例和片段身份不变，面板显示最终文案及“本地服务已连接、已保存”。证据见 [重载后 .3 面板](host-panel-v3-reloaded.png)。没有新增片段、配音或导出任务。

#42 第七条实际双端验收现已通过，可由 5/7 更新为 6/7。仅第三条真实宿主无有效本地目录场景仍未实测，保持未勾选，事项保持开启、代码不推送。本轮仅补充验收记录及截图，没有修改实现或测试；沿用上一轮已通过的回归结果，不声称本轮重跑全量测试。
