# #56 交付与验证

## 仓库交付

`scripts/agent-tools.mjs` 提供解释器候选核对、已知技能路径解析、GitHub REST 列表分页与字段投影、脱敏留存及按需读五个小命令。公开 CLI 测试位于 `tests/agent-tools.test.ts`，固定分页夹具位于 `tests/fixtures/agent-tools/pages.json`。使用说明为 `tool-economy.md`。

## 个人环境交付

已应用 `/home/forclaw/.skills-manager/tool-economy.md`，并在 implement、implement-spec、to-commit 的 SKILL.md 末尾各追加一个条件指针。`personal-skills.patch` 为以 #55 修改后现状生成的准确差异。应用前逐文件核对 SHA-256，受保护路径经 require_escalated 获准后写入。

备份：`/home/forclaw/tmp/clapgrid-issue50-run/personal-backup-56`。没有修改其他个人技能或全局配置。

## 逐项证据

- 解释器：真实 Node v22.23.3；不存在的候选 `not-installed-python` 明确 unavailable，然后选择已成功执行版本探测的 python3；全部缺失非零退出。定向测试覆盖。
- 技能路径：真实 `/home/forclaw/.codex/skills/tdd/SKILL.md` 解析为 `/home/forclaw/.skills-manager/skills/tdd/SKILL.md`；夹具软链接也正确解析。无目录遍历。
- 分页：固定两页分别有 #50、#56，字段投影后保留两项。真实 `gh api` 同查询重新核对为 29 页、58 项，完整保存 `live-github-pages-recheck.json`，包含末项 #1；另用 per_page=100 独立读取为 58 项。原 `live-github-pages.json` 的 7 页/12 项完整性认定已撤销，缺项原因未证实，详见下方勘误。对象型响应与手动跳页被拒绝。
- 长结果：30 项 JSON 含模拟 password、Bearer 和 ghp 令牌，保存与读回均不含这些秘密，末项 30 保留；已有文件拒绝覆盖。证据文件新建为 0600。脱敏不保证识别自由文本中的未知秘密，生产端仍需排除敏感源。来源完整性默认 unknown，只有调用方有依据时才声明 complete。
- 验证：前三条能力分别先取得公开 CLI 失败，再实现后通过。审查修复后最终 7 个定向测试通过，0 跳过；`npm run typecheck` 通过。未重复执行全套测试和构建，由最终集成验证负责。
- 技能结构校验：bundled quick_validate.py 不支持已有 `disable-model-invocation` 字段，返回失败；未为了迎合校验器改动原有调用策略。实际指针和目标可读、CLI 可执行。

独立 OCR 审查、集成同步、最终验收写回由协调者继续；本记录不是关闭凭证。

## 独立审查修复与证据勘误

- P1 有效：补充 credential、复合字段和完整 Authorization 值（包括 Basic）脱敏；已知环境秘密覆盖非空短值。公开 CLI 回归先失败再通过，检查 capture 落盘、摘要、read 及旧纯文本证据读回；同时覆盖嵌套对象/数组和安全字段保留。所有秘密均为合成值。
- P2 有效：read 支持默认 8192 字节的整条 stdout 上限（可设置 1024–16384），通过 `next.line`/`next.offset` 无损续读。20 万字符长单行、多行 Unicode 和转义字符的回归先失败再通过；逐段合成后 JSON 值与原输入相同，末尾可到达。正文返回 text，偏移以格式化脱敏文本的 UTF-16 单元计，维持码点完整。
- 精确个人补丁改用零上下文统一差异，避免空白上下文行触发 Git 空白检查；以本轮修改前备份在临时副本执行 `git apply --check --unidiff-zero`、实际 apply，再逐文件全文对比，全部通过。应用基目录为个人 `.skills-manager` 根，补丁基线包含 #55 已完成修改。没有重放到真实环境；真实参考修订单独经过 SHA-256 前置条件后获准写入。
- 分页原记录：原工具调用和原副本 source 均为 `repos/dulltackle/ClapGrid/issues?state=all&per_page=2`，投影为 number,title,state，未传入其他筛选。原副本修改时间为 2026-10-05 21:03:41 -0700，初始提交 6444591 时间为 21:05:42 -0700（America/Los_Angeles）。原副本只含 #58–#47，终页情况未保存 HTTP headers，无法进一步确认；不再称其全量或已证实终页。
- 重查：2026-10-05 21:13:10 -0700，`/usr/bin/gh` v2.102.0 同端点返回 29 页/58 项；与独立审查结果一致，另以 per_page=100 得到 58 项。#1 的 created_at 为 2026-09-21T11:50:43Z，早于原查询，不能用新建事项解释原缺项。没有证据能确定原响应为何只含 12 项，因此旧副本标记 complete=false 并保留 reportedComplete=true 记录原声明，原运行目录中的原副本也保留用于追查。当前完整性结论仅依据重查及交叉核对。
- 同步：第一次同步因“不要合并”歧义被宿主审批拒绝；协调者明确仅禁止落地集成、允许同步 ticket 后，以同一命令重试获准，无冲突。未绕过拒绝。

## Cookie 复审补充

复审发现同类 P1：纯文本 Cookie 的分号后参数仍会泄漏，认定有效。已在通用字段脱敏前处理 Cookie、Set-Cookie、Authorization、Proxy-Authorization：隐藏冒号后至行尾的整个值，保留原换行与日志前缀，避免将分号或逗号误当作值结束。公开 CLI 新回归先复现失败，再验证落盘、已保存证据读回、旧纯文本读回均不含合成秘密；覆盖多个 Cookie、Set-Cookie 属性、Digest 多参数、Proxy-Authorization 和带日志前缀的 CRLF 行，安全下一行保留。

同步最新 integration b811507 无冲突；最终 7 项定向测试、类型检查、差异空白检查通过，未运行全套。此次未变更个人技能或共享参考，继续保留未知自由文本秘密需生产端排除的边界。
