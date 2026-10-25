# 制作验收证据

通过统一入口运行 `node scripts/production.mjs evidence --project <项目根目录>`。清单的 `evidence` 字段指向项目内审阅记录 JSON。命令只读取记录与产物并输出状态，不改写验收原件或 GitHub 事项。

## 要求与记录

按 [ADR-0003](adr/0003-verification-evidence-boundary.md) 由人或独立审查者分类：`ran` 对应实际执行，`reviewed` 对应独立技术阅读，`user` 对应用户决定。优先把技术与人工要求拆开；保留混合要求时，`required` 列出全部子项。工具不会根据文字推断分类或为审美打分。

每条要求有稳定 `id`；每个子项指定类型、产物相对路径和实际审阅范围。范围使用项目中明确的稳定标识，例如口播片段 ID、相邻边界或已审动作。改变要求含义时更新子项标识或范围，由人确认，不能只沿用旧 ID 让旧证据覆盖新要求；语义是否改变由分类者维护，工具不解释。

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

`status` 可为 `passed`、`pending`、`failed`、`skipped`、`denied`。来源 `execution` 或 `actual-host` 用于 `ran`，`independent-review` 用于 `reviewed`，`user-confirmation` 用于 `user`；隔离回归使用 `controlled-test`。`provenance.record` 指向原日志、独立审查或实际用户发言，`actor` 标明原声明者，`observedAt` 保留原结论的实际时间。工具不认证声明者身份或证明指针的真实性，调用者须根据实际原件确认可信性。

## 变更与显式复用

旧版本的通过不会自动覆盖当前版本。内容或已审范围未变时，为当前版本新增记录并通过 `reuseOf` 指向原记录 ID，携带原来源、原证明指针和原结论时间；不能把复用日期当作新的用户确认日期。最新结论仍被否决、待审、失败或跳过时，不能挑更早的通过来复用；新的真实通过须由对应执行者、独立审查者或用户提供更晚的结论记录。

## 接入验收与回写

`earned` 仅表示声明的必需证据机械完整对应；存在受控测试记录时 `writeBackAllowed` 始终为 `false`。只有整条通过且采用真实来源的记录才是允许回写的候选；实际执行、独立技术阅读和用户确认继续遵守 ADR-0003，不能以工具通过代替实际观看、试听、领域判断或用户决定。

现有项目采用本入口时，在新记录中关联原验收条款及其原始日志/确认指针；历史格式无需迁移，既有档案按原字节保留。回写时先核对报告的审阅版本、实际产物摘要和证明原件，再只勾选赚得的完整条款；待审、否决或任何子项未通过时保持未勾选。命令本身不自动签认或回写。

调用 `scripts/production/evidence.mjs` 的业务接口时，`proof` 存在不代表通过，必须使用子项状态；基础核对结果与依赖影响下的复核结果不能合成无上下文的“有效”布尔值。
