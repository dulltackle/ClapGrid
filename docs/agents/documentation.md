# 文档维护约定

仓库只存放持续维护的当前指南与 ADR。一次性评估、试点、调研、验收和制作记录写在对应 GitHub Issue 或 PR 评论中，不提交到 `docs/`；Issue/PR 评论是唯一权威持久记录，本机原件按[验收原件与手动收尾](verification.md#验收原件与手动收尾)只在任务活跃期保留，Issue 关闭或 PR 合并且摘要写入后手动删除。历史制作与设计副本按 [ADR0013](../adr/0013-local-evidence-lifecycle.md) 不再在本机保留。指南只写现行规则，不记录某次运行的结果、迁移过程或“本轮”结论。

当前指南是除 `docs/adr/` 与 `tests/fixtures/` 外所有 Git 跟踪的 `*.md`，新目录默认受检。删除过时内容前核对仍有效的规则是否已有当前指南承载，补齐后再删除，并更新引用路径。旧的历史目录可从提交 `cec490e` 查阅，仅用于理解当时语义，不用于证明新版本通过。

[契约测试](../../tests/docs-commands.test.ts)检查当前指南中的 npm script、Vitest/Playwright 命令显式测试路径、废弃测试命令、相对文件链接及孤立文档。所有当前指南须从根目录任一 Markdown 或 `plugins/**/SKILL.md` 沿相对链接可达；新增指南时在对应入口补上链接。ADR 与夹具不受这五类规则校验。相对链接核对文件存在性，不验证章节锚点或网络 URL。

测试不支持行内豁免；需要解释旧测试机制时改写措辞，或链接到 ADR。脚本名称以 `package.json` 为准，日常检查见[检查与验收](verification.md)。

## 当前指南导航

按修改范围查阅对应指南：

- 事项与领域：[事项追踪](issue-tracker.md)、[分类标签](triage-labels.md)、[领域文档](domain.md)。
- 面板与配置：[统一组件维护](../ui-components.md)、[面板规范](../panel-style.md)、[导出设置](../export-settings.md)。
- 构建与交付：[构建身份](../build-identity.md)、[本机插件交付](plugin-delivery.md)、[Linux 组件](../linux-components.md)。
- 视频制作：[制作命令](../production.md)、[制作模板](../templates/video.md)、[依赖与局部重制](../production-impact.md)、[证据核对](../production-evidence.md)、[制作交付包](../production-package.md)、[抽检](../production-sample.md)。
- 测试执行：[原生 CI](../testing/native-ci.md)、[期限与等待](../testing/bounded-waits.md)、[项目生命周期](../testing/project-lifecycle.md)、[Vitest 夹具](../testing/vitest-fixtures.md)。
