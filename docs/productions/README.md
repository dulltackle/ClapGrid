# 历史制作工程

本目录的 Markdown 保留各历史审阅版本的说明。素材、制作脚本、独立依赖锁、字体、音频和产物已停止当前 Git 跟踪；迁移时本机原件原位保留，新 clone 不自带这些工程，也不承诺其他工作树自动保留原件。

需要复现时，从迁移前提交 `ee522f14e0b3a820e0ff1e47a4f3b01a011860e6` 恢复完整工程后，再执行历史说明中的命令：

```sh
git archive ee522f14e0b3a820e0ff1e47a4f3b01a011860e6 docs/productions/issue-104 | tar -x -C <独立恢复目录>
```

这些历史记录和原件不参与当前代码检查；新的制作项目沿现有项目入口管理。代码回归所需材料放入 `tests/fixtures/`，参与完整内容校验。范围决定见 [ADR0010](../adr/0010-code-check-input-boundary.md)。
