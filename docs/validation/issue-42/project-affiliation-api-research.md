# 当前聊天的宿主项目归属接口研究

日期：2026-10-04（America/Los_Angeles）。范围：第三方本地 ClapGrid 插件如何可靠区分「聊天属于桌面本地项目」与「聊天已移出项目但保留旧 cwd」。不修改业务实现或宿主配置。

## 结论与证据边界

**公开实验性项目接口存在且本机可调用，但本机结果与桌面当前项目归属不一致，尚不能直接用于 ClapGrid 的归属校验。** Codex app-server 的 `Thread.projectId` 与实验性 `project/read`、`project/list`、`thread/project/updated` 是应当实测的候选。不能只查看默认生成的稳定 schema 就判定不存在；实验性方法可能被排除。也不能把 app-server 的项目存储与桌面侧栏当前采用的项目存储视为同一个来源。

标准 MCP roots、OpenAI MCP Apps 扩展和 hooks 各有上下文能力，但本轮未发现它们承诺向第三方插件提供桌面项目归属和「移出项目」通知。这里的「未发现」限于下列所查公开资料，不是对全部私有宿主能力的否定。

## 公开接口候选

| 接口 | 已证实的公开定义 | 对本需求的限制 |
| --- | --- | --- |
| `thread/read` | 按 ID 读已存聊天，不恢复运行，也不订阅其事件 | 单次读取不提供持续失效通知；必须确认字段与桌面归属同步 |
| `Thread.projectId` | `string \| null`，源码定义为 app-server 所拥有的规范项目归属 | 与桌面 `list_threads.projectId` 同名不保证同源；已知实际桌面有项目时曾返回 null |
| `Thread.cwd` | 为聊天记录的工作目录 | 没有「不属于桌面项目就清空」的契约；不能替代项目归属 |
| 实验性 `project/list`、`project/read` | 项目包括 ID、名称、`roots[].path` 等；read 输入为 projectId | API 存在不等于当前桌面已经迁移/同步数据；需启用协议实验能力进行只读探测 |
| 实验性 `thread/project/updated` | 通知包含 threadId 和可空 projectId | 要验证实际桌面移动会触发、接收连接范围以及断线重连后的补读行为 |
| 实验性 `project/changed` | 包含 projectId 和 created/updated/deleted 变更类型 | 表示项目变化，不能独立替代某聊天的归属状态 |

来源：[app-server 文档](https://learn.chatgpt.com/docs/app-server)、[Thread 类型](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts)、[RPC 与通知注册](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs)、[项目请求、响应和通知类型](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/project.rs)。源码为研究日读取的主干；本机版本支持范围须以本机 schema 和运行结果为准。

稳定生成文件 `ClientRequest.ts` 没有列出上述实验性项目方法，但 `common.rs` 明确带有 `#[experimental(...)]` 标记。`thread/metadata/update` 的公开参数只修改 Git 信息，不应误用为项目归属接口。来源：[ClientRequest](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts)、[ThreadMetadataUpdateParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadMetadataUpdateParams.ts)。

## MCP 与插件扩展能否直接解决

- **MCP roots**：服务器可在客户端声明 capability 后调用 `roots/list`；支持变化时接收 `notifications/roots/list_changed`。定义的是可操作的文件系统根，不规定桌面项目选择模型，也没有当前聊天 ID 或桌面项目 ID 字段。因此即使将来启用 roots，也须额外确认空列表、多根、移出项目与调用聊天的对应语义。[MCP roots 规范](https://modelcontextprotocol.io/specification/2025-06-18/client/roots)
- **OpenAI MCP Apps 扩展**：thread entrypoint 为每个聊天创建独立实例；`openai/modelContext` 回报组件提供的模型上下文及附件变化，`openai/deepLink` 回报组件内链接；这些不是桌面项目归属。所查规范未定义项目查询/归属字段。文件入口注入的 `_meta["openai/resource"].path` 是打开文件的路径，也不能由此反推聊天项目。[OpenAI 扩展规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
- **Hooks**：公共输入有 session_id、cwd 等；所列事件涉及会话/轮次/工具/压缩等，未发现项目迁移事件或归属输入。SessionEnd 也不等于用户切换或移出项目。MCP tool hook 是宿主在生命周期事件发生时调用已连接服务器，不是第三方服务器可查询桌面所有内置工具的反向接口。[Hooks 文档](https://learn.chatgpt.com/docs/hooks)
- **静态 MCP 配置**：cwd、env/env_vars 是进程配置，文档未赋予它们每次调用的桌面归属状态语义。[MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- **MCP Events**：文档描述插件服务器向 ChatGPT 提交外部事件；不是桌面项目状态向本地插件推送的机制。[MCP Events](https://developers.openai.com/plugins/build/mcp-events)

## 桌面内置工具与私有实现

模型可调用桌面内置 `list_threads`，不代表第三方 MCP 服务可以反向调用同一工具。前者通过宿主专用能力执行；后者必须存在明确的连接、权限及调用协议。应将内置工具结果用作本轮诊断对照，不能把「让模型每次检查一次」视为服务端连续校验：面板操作可在模型无活动时发生，移出项目后旧连接仍可能存活。

读取宿主私有数据库/状态 JSON、复用未公开内部 pipe/IPC 或抓取侧栏，均只能作为诊断候选。若作为正式产品依赖，需承担版本变更、宿主权限和状态一致性问题。本轮不推荐把它们当作稳定公共契约；没有因为发现内部字符串或 socket 就声明第三方调用受支持。

## 后续验证及可行方案

1. 优先对本机实验性 app-server 只读接口做能力探测：`initialize` 声明实验能力，读取本聊天与桌面已知 projectId，对照 `project/list`、`project/read`。不创建、导入或重写宿主项目来让实验成功。
2. 若能获得同源数据，再验证有项目→移出→移回时 projectId 的状态和通知。独立启动的 app-server 能读数据，不自动意味着可以收到另一个进程/桌面实例的变更；失效策略必须有重新查询兜底。
3. 若当前桌面尚未采用该数据源，完整实现需要宿主提供并维护一个可信的当前聊天项目查询/变化接口。ClapGrid 应把「无项目」与「无法验证」都当作拒绝访问，并使面板连接失效。
4. 若产品接受仅在打开入口检查，可由模型调用内置工具后执行；但这不满足当前要求的旧面板持续保护，不应据此勾选完成。

本研究不调整 ADR-0001 或 #42 的验收定义，不声称当前候选 `.2` 已实现移出项目后的禁用。

## 本机实测补充

### 版本与只读探测

桌面 ChatGPT 26.930.31730、Linux；使用桌面自带 `/usr/lib/chatgpt/resources/codex`，版本 0.160.0。ClapGrid 已安装版本为 `0.1.0+codex.issue42.20261004.2`。命令行 `codex` 与上述桌面二进制为同一个文件路径。

运行 `codex app-server generate-json-schema --experimental --out /tmp/clapgrid-42-project-schema`，确认本机含 `project/list`、`project/read` 等方法。另开短生命周期 stdio app-server，通过 `initialize.capabilities.experimentalApi=true` 后只读调用；不创建、导入、迁移或修改任何宿主项目。探测脚本为本机 `/tmp/clapgrid-42-project-api-probe.py`。

当前聊天 `01a105b2-1d4a-7f03-b0dd-a6bddbcc4f5c` 已回到 ClapGrid 项目：

| 读取来源 | 结果 |
| --- | --- |
| 桌面内置 `list_threads` | projectId=`82902b9f-5808-4a64-b677-023a50d84106`，cwd=`/home/forclaw/code/ClapGrid` |
| 独立 app-server `thread/read` | 同一聊天、同一 cwd，但 projectId=null |
| 独立 app-server `project/list` | 有名为 ClapGrid 的项目，ID=`01a0c261-abf4-7ce0-955c-feff4d8fb878`；另有 tmp 与 WeTrim，均与桌面项目 ID 不同 |
| `project/read` 输入桌面的 ClapGrid ID | 错误 -32602：`project not found: 82902b9f-5808-4a64-b677-023a50d84106` |

这些结果证实当前读取方式获得的归属状态与桌面不一致。不能按名称或 roots 路径映射来补齐：移出项目后 cwd 不变，路径匹配仍会误判属于原项目。也未验证连接桌面正在使用的 app-server 是否能得到不同结果；没有为此启动 daemon、修改宿主配置或导入项目。

### 内置工具管道的实际实现

读取已安装的 [codex-app-tools/server.mjs](/home/forclaw/.codex/plugins/cache/openai-bundled/codex-app-tools/0.1.5/server.mjs:24771)，发现它通过 `CODEX_APP_TOOLS_PIPE_PATH` 连接本地 NativePipeClient，使用长度前缀 JSON-RPC 转发 `tools/list` 和 `tools/call`。调用携带 namespace、tool、callerSource、threadId、turnId 等，而非 app-server 的 project/read。故桌面内置工具能查到归属，不能反证公开 app-server 已同步该状态。

只读核查实际进程环境变量是否存在（未输出管道地址或其他变量值）：当前 ClapGrid MCP 进程没有 `CODEX_APP_TOOLS_PIPE_PATH`；通过宿主 shell 启动的两个 ClapGrid 后台服务继承了该变量。说明本机私有桥有技术适配的可能，不能说完全不可达；但本轮未直接调用该管道，也未验证权限、可用生命周期、宿主重启及变更通知。不能将继承到变量等同于第三方插件受支持的接口。

本机打包桌面代码也可见 `thread-project-memberships-updated` 和 projectless 状态管理，属于私有实现证据，不是插件订阅规范。

### 对实现决策的影响

- **仅用公开接口直接补判断：当前不成立。** 不能用现有 `Thread.projectId=null` 拒绝全部访问，否则已有桌面项目也会被误拒绝。
- **要求稳定可分发的插件：仍缺已验证的宿主归属契约。** 需要宿主同步 app-server 的项目归属，或公开面向插件的等价查询与失效通知。
- **接受当前桌面版本的私有适配：可开展独立原型。** 优先仅查询当前聊天归属；验证移出/移回及宿主重启，通道缺失或查询失败即拒绝，且不得读取其他进程的管道地址来绕过未提供的能力。此路线不应描述为稳定公共 API。

本轮只添加研究记录，未修改插件实现、安装状态、宿主配置或 issue 验收勾选。

## 后续安排

2026-10-04 用户决定将「移出桌面项目后禁止 ClapGrid」延期，已建立 [#48 聊天移出宿主项目后禁止 ClapGrid 访问](https://github.com/dulltackle/ClapGrid/issues/48)，包含本研究证据、接口缺口和验收标准。#42 同步增加范围澄清，保留无有效本地目录时拒绝的要求；不把延期场景标记为通过。本轮不实施私有管道适配。
