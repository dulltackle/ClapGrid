# 项目审查规范

判断性规范由 [OCR 项目规则](.opencodereview/rule.json) 维护，供独立审查者通过现有 `ocr delegate preview` 与 `ocr delegate rule` 入口读取。实现代理仍按既有领域文档和事项工作，无需每次加载一套重复审查手册。

规则正文只在 `.opencodereview/rule.json` 一处维护，由 OCR 自动发现；调用时不传覆盖项目规则的 `--rule`。项目规则有意替代 OCR 内置的通用风格清单，只保留项目需要的行为与安全判断，不新增函数长度、命名风格等门槛。采纳依据见 [#50](https://github.com/dulltackle/ClapGrid/issues/50) 与 [#58](https://github.com/dulltackle/ClapGrid/issues/58)；历史来源记录可从提交 `e66e1b7` 的 `docs/review/provenance.md` 查阅，仅用于理解当时语义。类型、测试、构建使用现有 `npm run check`；审查上下文的本地链接使用 `npm run review:check`，该检查也由测试套件运行。

从仓库根目录调用 `ocr delegate rule --format json src/business/index.ts tests/business.test.ts`，应得到 `source: project` 与项目规则正文。先用 preview 确定实际变更文件，再逐项审查并记录覆盖；保持独立审查及修复后复核流程。项目规则显式纳入测试文件，避免 OCR 默认过滤遗漏行为回归。
