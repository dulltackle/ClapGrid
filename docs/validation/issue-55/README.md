# #55 验收前提与授权续接

仓库交付为个人技能准确差异 `personal-skills.patch`、固定输入 `scenarios.json` 和回放方法 `replay.md`。没有新增通用验收工具、调度框架或夹具平台。

个人环境已定向更新 `~/.skills-manager/skills/` 下的 `implement/SKILL.md`、`implement-spec/SKILL.md`、`implement-spec/acceptance.md`、`to-commit/SKILL.md`，新增共用普通参考 `acceptance-preflight.md`。三个入口在开始与续接时加载参考，最终验收再次核实入口；to-commit 单独区分无法执行与纯阅读判断。既有独立 OCR 审查和证据写回要求保留。

补丁路径以个人 skills 根目录为基准。新增文件由 `/dev/null` 表示。应用前核对旧内容；本轮应用使用逐文件 SHA-256 前置校验，避免覆盖同期修改。原始备份、应用清单和完整回放结果由协调者保存在仓库外运行记录 `/home/forclaw/tmp/clapgrid-issue50-run`；本仓库补丁可独立审阅个人变更。

静态校验与回放结果见工单报告及最终协调者记录。宿主真实验收、最终集成全套测试与人工确认分开记录；尚未执行的场景不能算通过。
