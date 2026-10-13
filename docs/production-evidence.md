# 制作验收证据

通过统一入口运行 `node scripts/production.mjs evidence --project <项目根目录>`。清单的 `evidence` 字段指向项目内审阅记录 JSON；使用既有 `--manifest` 和 `--report` 参数。命令读取记录与产物，输出各子项及整条要求的状态、证据 ID 和回写判定，不改写验收原件或 GitHub 事项。

## 要求与记录

按 [ADR-0003](adr/0003-verification-evidence-boundary.md) 由人或独立审查者分类：`ran` 对应实际执行，`reviewed` 对应独立技术阅读，`user` 对应用户决定。优先把技术与人工要求拆开；保留混合要求时，`required` 列出全部子项。工具不会根据文字推断分类或为审美打分。

每条要求有稳定 `id`，可同时保留原文 `text`；`classifiedBy` 记录分类者。每个子项指定类型、产物相对路径和实际审阅范围。范围使用项目中明确的稳定标识，例如口播片段 ID、相邻边界或已审动作；同一范围使用相同标识。改变要求含义时更新子项标识或范围，由人确认，不能只沿用旧 ID 让旧证据覆盖新要求。

以下为受控示例，不能作为真实用户确认或正式验收证据；`sha256` 需替换为文件实际内容的 64 位小写摘要。

```json
{
  "schemaVersion": 1,
  "reviewVersion": "review-2",
  "requirements": [{
    "id": "R1",
    "text": "该画面的技术检查与用户视觉确认均已完成",
    "classifiedBy": { "source": "human", "identity": "项目作者" },
    "required": [
      { "id": "technical", "kind": "ran", "artifact": "outputs/A.mp4", "scope": ["A"] },
      { "id": "visual", "kind": "user", "artifact": "outputs/A.mp4", "scope": ["A"] }
    ]
  }],
  "records": [{
    "id": "technical-2",
    "requirement": "R1",
    "criterion": "technical",
    "kind": "ran",
    "reviewVersion": "review-2",
    "artifact": { "path": "outputs/A.mp4", "sha256": "填入实际内容摘要" },
    "scope": ["A"],
    "status": "passed",
    "source": "controlled-test",
    "provenance": {
      "actor": "受控测试执行者",
      "record": "受控测试模拟执行日志",
      "observedAt": "2026-10-13T00:00:00Z"
    }
  }]
}
```

`records` 是声明过的执行或审阅结论，记录 ID 唯一；每个当前版本子项必须唯一对应一份记录。`status` 可为 `passed`、`pending`、`failed`、`skipped`、`denied`。来源 `execution` 或 `actual-host` 用于 `ran`，`independent-review` 用于 `reviewed`，`user-confirmation` 用于 `user`；隔离回归统一使用 `controlled-test`。证明指针 `provenance.record` 可指向原日志、独立审查或实际用户发言，`actor` 标明原声明者，`observedAt` 保留原结论的实际时间。工具核对这些字段的完整性，不认证声明者身份或证明指针的真实性；调用者仍须根据实际原件确认可信性。

当前版本缺少任一必需子项时整条保持待审；失败、跳过、否决、错误版本、错误类型、错误范围、错误文件或内容摘要差异均不能通过。命令流式读取产物计算摘要，机械核对实际内容，不从文件名猜测内容身份。只有非空的全部子项通过，整条才通过。

## 变更与显式复用

旧版本的通过不会自动覆盖当前版本。内容或已审范围改变后需要新证据；未变内容与范围可以复用，但要为当前版本新增记录，通过 `reuseOf` 指向原记录 ID，并保留原记录。复用记录使用当前 `reviewVersion` 与当前产物路径，携带同一内容摘要、要求与子项、类型、范围、来源及原证明指针和结论时间；不能把复用日期当作新的用户确认日期。

命令追溯整条复用关联，拒绝缺失原件、循环、未通过原结论或内容/范围/来源差异。它还按原 `observedAt` 检查同一要求、子项、类型、内容与范围的最新对应结论：真实来源与受控测试分别比较，类型与来源不匹配的历史记录不参与比较。最新结论仍被否决、待审、失败或跳过时，不能挑更早的通过来复用；同一最新时间存在冲突时保留未通过状态。新的真实通过须由对应执行者、独立审查者或用户提供更晚的结论记录。

仅修改记录的备注或无关文字不会改变产物的内容摘要，也不自动使媒体确认失效。稳定标识及范围是否仍代表同一要求，由分类者维护；工具不解释文字的语义变化。原始记录和历史档案保留原字节。

## 接入验收与回写

`details.requirements` 逐条返回 `status`、`earned`、`evidenceIds`、`controlledTest` 与 `writeBackAllowed`。`earned` 仅表示声明的必需证据机械完整对应；存在受控测试记录时，即使模拟通过，`writeBackAllowed` 仍为 `false`。只有整条通过且采用真实来源的记录，才产生允许回写的机械候选；实际执行、独立技术阅读和用户确认继续遵守 ADR-0003，不能以工具通过代替实际观看、试听、领域判断或用户决定。

现有项目采用本入口时，在新记录中关联原验收条款及其原始日志/确认指针；历史格式无需迁移。#104 等既有档案和待审记录作为原件保留，新增证据可以补齐对应范围，不改写历史状态。按照现有验收回写流程，先核对报告的审阅版本、实际产物摘要和证明原件，再只勾选赚得的完整条款；待审、否决或任何子项未通过时保持未勾选。命令本身不自动签认或回写。

统一入口在执行前收集证据声明的产物与能定位为项目内文件的原证明指针，按真实路径保护它们，包含符号链接别名。`--report` 与关联原件碰撞时拒绝执行并另存失败报告；写报告前再次核对。证明文件被保护不表示其内容或声明者已经获认证。

`tests/production-evidence.test.ts` 从隔离小项目调用真实入口，覆盖缺失人工确认、否决、执行失败、跳过、版本/范围/类型/内容不匹配、完整匹配、复用与原件保留。该文件通过既有 `npm test` 纳入 `check`/`verify` 和 CI，命令模块由现有制作 `checkJs` 类型检查覆盖；回归不代表样片或实际宿主已经通过。
