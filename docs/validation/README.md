# 历史验收记录

Markdown 说明仅记录对应历史版本的观察与结论，不代表当前版本已经验收。页面中的截图、JSON、trace、日志及其他原始证据已停止当前 Git 跟踪；迁移时本机文件原位保留，新 clone 中相对原件链接可能不可用。

可从迁移前提交 `ee522f14e0b3a820e0ff1e47a4f3b01a011860e6` 使用 `git show <提交>:<文件路径>` 查看单个原件，或用 `git archive <提交> docs/validation | tar -x -C <独立恢复目录>` 恢复完整历史证据。恢复后的原件仍归原版本，不能作为本次新验收。

当前检查仍保存原生报告、来源摘要和执行身份，证据规则见 [检查与正式验收](../agents/verification.md)。本目录退出代码输入的原因见 [ADR0010](../adr/0010-code-check-input-boundary.md)。
