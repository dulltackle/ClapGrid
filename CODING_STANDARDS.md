# 项目审查规范

判断性规范由 [OCR 项目规则](.opencodereview/rule.json) 维护，供独立审查者通过现有 `ocr delegate preview` 与 `ocr delegate rule` 入口读取。实现代理仍按既有领域文档和事项工作，无需每次加载一套重复审查手册。

规则来源、采纳范围与历史缺口见 [来源记录](docs/review/provenance.md)。类型、测试、构建使用现有 `npm run check`；审查上下文的本地链接使用 `npm run review:check`，该检查也由测试套件运行。

从仓库根目录调用 `ocr delegate rule --format json src/business/index.ts tests/business.test.ts`，应得到 `source: project` 与项目规则正文。先用 preview 确定实际变更文件，再逐项审查并记录覆盖；保持独立审查及修复后复核流程。项目规则显式纳入测试文件，避免 OCR 默认过滤遗漏行为回归。
