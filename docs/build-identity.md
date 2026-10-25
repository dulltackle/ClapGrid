# 构建与运行身份

`npm run plugin:build` 写入构建身份并嵌入各入口 bundle。诊断返回进程已加载的常量，因此磁盘包更新不会改变旧进程报告的身份；判断是否已重载必须比较运行中的身份。

## 解读原则

- 只有 `contentFingerprint` 能证明内容一致；版本号、路径、源码提交与 clean/dirty 状态只作来源参考。普通源码运行、旧包或缺失身份时报告 `unknown`。
- 核对磁盘包使用 `scripts/plugin-identity.mjs` 的 `readPluginIdentity(directory)`，它会重新计算指纹并验证所有入口；不要只解析 `build-identity.json` 就假定包内容一致。
- 指纹用于识别构建内容，不是发布者签名。

## 一次核对四种身份

```sh
npm run diagnose:identity -- --build dist/plugin/clapgrid \
  --installed /明确的安装目录 \
  --mcp-evidence /临时目录/host-evidence.json \
  --workspace /当前工作空间 --service-url http://127.0.0.1:现存端口
```

除 `--build` 外均可省略，省略的目标保留 `unknown`。退出码 0 表示完成诊断，身份异常由各项 `status`（`match`、`mismatch`、`unknown`、`unreachable`）表示。基准缺失时，即使目标报告指纹也不判一致。

命令不能直接调用桌面宿主的工具。先通过当前聊天的实际宿主调用 `clapgrid_host_context`，把该次 `structuredContent` 放入证据文件的 `response`，使用真实采集时间：

```json
{
  "source": "actual-host",
  "observedAt": "2026-10-06T00:00:00.000Z",
  "status": "reachable",
  "response": { "buildIdentity": { "schemaVersion": 1, "state": "unknown" } }
}
```

入口确实不可达时填 `status: "unreachable"` 并省略 `response`；受控集成测试必须填 `source: "controlled-test"`。不把旧证据改时间当成新调用。证据来源是提供者声明，不是命令独立证明的宿主身份；超过 5 分钟或来自未来的证据保留未知，有效证据也只证明调用时刻，不能独立证明当前宿主已重载。缺少宿主证据时不另起 MCP 替代。

发现不一致后按 `nextSteps` 处理：先人工确认并更新安装包，再重载宿主、重新采集 MCP 证据；服务重启由维护者确认当前工作空间无运行任务后决定。真实宿主验收需分别保存重载前后原始调用与汇总结果，受控测试通过不能代替。
