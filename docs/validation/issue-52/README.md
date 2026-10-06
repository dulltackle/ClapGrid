# Linux 导出拒绝进程追踪

独立工作流 `process-trace.yml` 在推送和 PR 时运行，也支持手动触发。固定 Ubuntu 24.04 和 Node 22.23.3，安装 FFmpeg、ffprobe、fontconfig、Noto Sans CJK 字体及 strace，通过锁文件安装 npm 依赖。供应商响应受控，不调用真实收费供应商；这不是实际宿主或供应商验收。

本地复现：

```bash
npm ci
node scripts/verify-speech-export-processes.mjs .cache/process-trace
```

命令沿用配音导出锁回归，检查成功、明确失败、中断的 accepted/running 窗口及批量等待窗口。真实基线导出的 FFmpeg 启动必须存在；缺少窗口、空追踪、测试失败、依赖或追踪权限不可用均返回非零状态。

输出目录包含 `exec.trace` 原始追踪、`tests.tap` 测试日志、`preflight.log` 依赖和权限诊断、`result.json` 机器可读结果及 `summary.md` 摘要。每次运行覆盖这些文件，避免复用上次成功结果。CI 即使失败也上传证据；前置安装失败时摘要明确显示未执行，并保留安装日志，不能视作通过。

可控前提缺失验证（不修改系统安装）：

```bash
node --import tsx --test tests/process-trace-command.test.ts
```

该测试在子进程里将 PATH 指向空临时目录，验证缺少 strace 导致退出状态 1，并保留失败原因及全部诊断文件。真实 CI 作业结果及未执行项由对应事项交付记录单独记录。
