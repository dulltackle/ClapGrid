# 文档维护约定

新增或整理 Markdown 时，按用途放置：一次性评估、试点和调研记录放 `docs/research/`，验证记录放 `docs/validation/`，具体制作记录放 `docs/productions/`。`docs/` 根、`docs/agents/` 和 `docs/testing/` 仅存放持续维护的当前指南。

当前指南是除 `docs/validation/`、`docs/research/`、`docs/productions/`、`docs/adr/` 与 `tests/fixtures/` 外所有 Git 跟踪的 `*.md`，新目录默认受检。整理历史文件时核对仍有效的规则是否已有当前指南承载，补齐后再删除或移动，并更新引用路径。历史记录保留当时语义，不用于证明新版本通过。

[契约测试](../../tests/docs-commands.test.ts)检查当前指南中的 npm script、Vitest/Playwright 命令显式测试路径、废弃测试命令、相对文件链接及孤立文档。所有当前指南须从根目录任一 Markdown 或 `plugins/**/SKILL.md` 沿相对链接可达；新增指南时在对应入口补上链接。历史目录内容不受这五类规则校验；当前指南指向历史文件的链接仍须存在。相对链接核对文件存在性，不验证章节锚点或网络 URL。

测试不支持行内豁免；需要解释旧测试机制时改写措辞，或链接到 ADR/历史记录。脚本名称以 `package.json` 为准，日常检查见[检查与验收](verification.md)。

## 当前指南导航

按修改范围查阅对应指南：

- 事项与领域：[事项追踪](issue-tracker.md)、[分类标签](triage-labels.md)、[领域文档](domain.md)。
- 面板与配置：[统一组件维护](../ui-components.md)、[面板规范](../panel-style.md)、[导出设置](../export-settings.md)。
- 构建与交付：[构建身份](../build-identity.md)、[本机插件交付](plugin-delivery.md)、[Linux 组件](../linux-components.md)。
- 视频制作：[制作命令](../production.md)、[制作模板](../templates/video.md)、[依赖与局部重制](../production-impact.md)、[证据核对](../production-evidence.md)、[制作交付包](../production-package.md)、[抽检](../production-sample.md)。
- 测试执行：[原生 CI](../testing/native-ci.md)、[迁移与保障承接](../testing/native-retirement.md)、[期限与等待](../testing/bounded-waits.md)、[项目生命周期](../testing/project-lifecycle.md)、[Vitest 夹具](../testing/vitest-fixtures.md)。
- 测试场景：[编辑](../testing/native-editing.md)、[焦点](../testing/native-focus.md)、[布局](../testing/native-layout.md)、[媒体](../testing/native-media.md)、[性能](../testing/native-performance.md)、[进程](../testing/native-processes.md)、[勾选](../testing/native-selection.md)、[服务](../testing/native-services.md)。
