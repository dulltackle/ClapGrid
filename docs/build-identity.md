# 构建与运行身份

`npm run plugin:build` 在 `dist/plugin/clapgrid/build-identity.json` 写入身份，并把同一身份嵌入 MCP、服务、运行入口和媒体工作进程的 bundle。诊断直接返回已加载的常量，不在请求时读取身份文件，因此磁盘包更新不会改变旧进程报告的身份。

公开只读接口：

- MCP `clapgrid_host_context` 的 `buildIdentity`。
- HTTP `GET /api/identity` 的 `buildIdentity`，沿用原有工作空间归属信息。

已知身份格式：

```json
{
  "schemaVersion": 1,
  "state": "known",
  "version": "0.1.0",
  "source": { "commit": "Git 提交哈希", "state": "clean" },
  "contentFingerprint": "sha256:内容摘要"
}
```

`source.state` 为 `clean`、`dirty` 或 `unknown`。有未提交或未跟踪文件时记录 `dirty`；无 Git 来源时提交为 `null`、源码状态为 `unknown`，构建内容仍可核对。普通源码运行、旧包或缺失身份的运行入口返回 `{"schemaVersion":1,"state":"unknown"}`。版本和路径不能替代指纹比较。

磁盘包核对应调用 `scripts/plugin-identity.mjs` 的异步 `readPluginIdentity(directory)`，该函数只读文件，不启动进程或服务。它重新计算指纹并验证所有入口的嵌入身份；文件缺失、内容变化或格式无效均返回未知。不要只解析 JSON 后假定包内容一致。

指纹采用 SHA-256，按固定顺序遍历普通文件，将相对路径长度、路径、字节长度和内容纳入摘要。为避免自引用，仅排除根目录 `build-identity.json` 和四个固定 bundle 入口首行的身份常量；被排除的首行仍须与元数据的完整身份一致。符号链接及其他非普通文件使校验失败。指纹用于识别构建内容，不是发布者签名。诊断没有自动安装、重载、启动服务或创建项目的行为。

## 一次核对四种身份

```sh
npm run diagnose:identity -- --build dist/plugin/clapgrid \
  --installed /明确的安装目录 \
  --mcp-evidence /临时目录/host-evidence.json \
  --workspace /当前工作空间 --service-url http://127.0.0.1:现存端口
```

如需直接处理 JSON，使用 `node scripts/diagnose-identity.mjs` 加同样参数。所有参数除 `--build`（默认构建输出目录）外均可省略；省略目标保留 `unknown`。退出码 0 表示完成诊断，身份异常由各项 `status` 表示；参数错误退出 1。

`build` 为内容核验后的基准，`installed`、`mcp`、`service` 仅比较同类 `contentFingerprint`。输出 `match`（一致）、`mismatch`（不一致）、`unknown`（信息不足）、`unreachable`（明确尝试但不可达），并保留参与比较的指纹与判定原因。源码提交与 clean/dirty/unknown 状态只作来源参考；版本号和目录不能证明内容一致。基准缺失时，即使目标报告指纹也不判一致。

命令不能直接调用桌面宿主的工具。先通过当前聊天的实际宿主调用 `clapgrid_host_context`，把该次 `structuredContent` 放入以下证据格式的 `response`；使用真实采集时间，不把旧证据改时间当成新调用：

```json
{
  "source": "actual-host",
  "observedAt": "2026-10-06T00:00:00.000Z",
  "status": "reachable",
  "response": { "buildIdentity": { "schemaVersion": 1, "state": "unknown" } }
}
```

入口确实不可达时填 `status: "unreachable"`，省略 `response`。受控集成测试必须填 `source: "controlled-test"`，不能标作真实宿主。证据来源是提供者声明，不是命令独立证明的宿主身份。证据超过 5 分钟或来自未来即保留未知；有效证据仍标注 `live: false`，仅证明调用时刻，不能独立证明当前宿主已重载。缺少宿主证据时绝不另起 MCP 作为替代。

服务查询仅接受无凭据、查询参数和跳转的本机 HTTP 根地址，通过 `GET /api/identity` 核对应用与当前工作空间；不会搜索、借用其他工作空间或启动服务。输出只投影定型身份字段，不输出原始响应、错误、令牌或任意元数据。命令不写文件、不安装、不重载、不创建项目或制作任务。

发现不一致后按 `nextSteps` 处理：先人工确认并更新安装包，再重载宿主、重新采集 MCP 证据；服务重启由维护者确认当前工作空间无运行任务后决定。真实宿主验收需分别保存重载前后原始调用与汇总结果，受控测试通过不能代替这一项。
