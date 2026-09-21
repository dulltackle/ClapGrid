# 领域文档

## 探索前读取

采用 single-context 布局：
- 根目录 CONTEXT.md：领域术语及模型。
- docs/adr/：读取与当前工作相关的架构决策。

如果未来存在 CONTEXT-MAP.md，先读取索引，再读取相关上下文的
CONTEXT.md 和 src/<context>/docs/adr/。

文件不存在时，直接继续工作，无需提示缺失或预先创建。
由 domain-modeling 在术语或决策明确后按需生成。

## 术语

事项标题、重构建议、假设和测试名称使用 CONTEXT.md 定义的术语。
需要的概念尚未收录时，先判断是否属于项目语言；
确有缺口则记录，供 domain-modeling 后续处理。

## 决策冲突

建议与现有 ADR 冲突时，明确指出 ADR 编号、冲突点和重新讨论的理由。
