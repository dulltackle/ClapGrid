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

实际宿主与面板的采集方式及字段见[证据格式](agents/plugin-delivery.md#证据格式)。

发现不一致后按 `nextSteps` 处理。先人工确认并更新安装包，再重载宿主、重新采集 MCP 证据。服务重启由维护者确认当前工作空间无运行任务后决定。
