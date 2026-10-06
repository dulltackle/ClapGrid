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
