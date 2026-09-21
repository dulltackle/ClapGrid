# Agent 协作规范

## 沟通规则

- 与开发者沟通时，始终使用中文。
- 回答问题、解释方案、汇报进展时，统一使用中文。
- 编写文档、注释说明、交付说明等面向开发者的内容时，统一使用中文。
- 生成 Git commit message 时，统一使用中文。

## Git 提交规范

### 基本原则

- 不执行破坏性操作，例如强制推送、硬重置、配置更改。
- 不主动绕过钩子，例如 `--no-verify`、`--no-gpg-sign`，除非用户明确要求。

### 提交范围规则

- 如果同时存在已暂存和未暂存更改，只提交当前已暂存文件。
- 如果只有已暂存更改，只分析并提交已暂存内容。
- 如果没有已暂存文件，则分析全部未跟踪和未暂存文件，并在确认后统一暂存提交。
- 不得改变用户已有的暂存集合。

### 提交消息规范

使用 Conventional Commits 格式：

```text
<type>: <description>

[body]

[optional footer(s)]
```

常用类型：

- `feat`：新功能
- `fix`：Bug 修复
- `docs`：文档更改
- `style`：格式调整
- `refactor`：重构
- `perf`：性能优化
- `test`：测试相关
- `build`：构建或依赖
- `ci`：CI 配置
- `chore`：其他维护
- `revert`：回滚提交

## Agent skills

### Issue tracker

使用 dulltackle/ClapGrid 的 GitHub Issues；操作事项或规格前，读取 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认 triage 标签；分类事项前，读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context 布局；探索代码或讨论领域概念、架构决策前，读取 `docs/agents/domain.md`。
