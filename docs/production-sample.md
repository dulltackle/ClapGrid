# 动态样片与视觉方向确认

开始批量制作前，先展示能代表本项目实际素材、主要动作和转场的动态样片，由真实用户确认视觉方向。确认前可以制作与修改样片，批量制作须通过 `node scripts/production.mjs sample --project <项目根目录>` 核对，且报告 `details.batchAllowed` 为 `true`。不固定样片时长、场景数、配色或输出参数；代表性由制作人说明、用户实际观看判断。

## 样片与采用方案

在项目 `video.md` 简要记录整体观感、样片引用、采用方案、确认范围与待审事项。清单的 `sample` 区域采用以下结构；摘要为实际文件的 64 位小写 SHA-256，范围使用只描述视觉方向的 `visual:` 标识。方案文件只保存实际视觉决策，普通制作备注放在 `video.md`；无需强制填写完整配色、字体和动作参数表。

```json
{
  "id": "direction-sample-1",
  "mode": "actual-project",
  "reviewVersion": "visual-review-1",
  "video": { "path": "sample.mp4", "sha256": "填入实际内容摘要" },
  "plan": { "path": "visual-plan.json", "sha256": "填入实际内容摘要" },
  "scope": ["visual:materials", "visual:motion", "visual:A-to-B"],
  "representative": {
    "materials": ["本样片实际展示的素材身份"],
    "motions": ["本样片的主要动作"],
    "transitions": ["本样片实际展示的转场"]
  },
  "confirmation": {
    "requirement": "visual-direction",
    "videoCriterion": "sample-video",
    "planCriterion": "visual-plan"
  }
}
```

`mode: controlled-test` 专用于隔离机制演练，不取得实际批量许可；即使模拟真实来源字段也保持未许可。实际供用户观看的项目使用 `actual-project`，它仍须有真实用户来源的完整确认记录。工具不能认证声明者身份或原证明指针真实性，制作人必须依据实际用户发言填写，不能把自己的判断或测试状态写成用户确认。

命令核对样片与方案的实际内容身份，并调用真实 FFprobe/FFmpeg 计数与完整解码视频，拒绝静态图片、单帧或损坏媒体。它不自动判断动作是否足够明显、转场是否合适或样片是否具有代表性；可播放与解码通过不能代替视觉审阅。

## 接入用户证据

清单 `evidence` 继续指向[制作验收证据](production-evidence.md)的原始记录。`confirmation.requirement` 指定视觉方向要求，两个子项必须均为 `kind: user`，分别关联样片和采用方案路径，并使用与 `sample.scope` 完全相同的范围。记录与样片使用同一审阅版本；两个子项关联同一实际用户确认的 `actor`、`record` 和原 `observedAt`。来源为 `user-confirmation`，状态由实际发言决定，未确认保留空记录或待审，否决保留原结论。

示例子项如下，填写真实记录前不表示其已经通过：

```json
[
  { "id": "sample-video", "kind": "user", "artifact": "sample.mp4", "scope": ["visual:materials", "visual:motion", "visual:A-to-B"] },
  { "id": "visual-plan", "kind": "user", "artifact": "visual-plan.json", "scope": ["visual:materials", "visual:motion", "visual:A-to-B"] }
]
```

每个记录按原证据格式关联 `requirement`、`criterion`、`artifact: {path, sha256}`、版本、范围、结论与原来源；样片和方案都必须匹配。完整技术记录或独立阅读记录不能代替这两个用户子项。样片、采用方案、用户来源或范围不匹配时保持待审或待修改。

方案、样片内容及已审范围未变时，可在新的审阅版本显式 `reuseOf` 两份原用户记录，保留原来源和原确认时间，不逐口播片段重复请求同一方案确认。实质修改方案或样片、扩大范围后，需要重新展示受影响部分并记录真实新结论。工具按内容摘要与稳定范围核对；语义是否实质改变由制作人负责，不把改 ID 或改日期作为重新确认。更晚的否决或待审不能被较早的通过绕过。

## 结果与终审边界

报告保留样片和方案身份、视觉范围、代表性说明、证据 ID、原来源及复用关联。`mechanicalEvidenceComplete` 只说明所选要求机械对应完整；`batchAllowed` 还要求实际项目、真实用户来源且全部必需子项通过。其它验收要求仍待审时，已赚得的视觉方向范围可继续使用；该报告不会将其它要求改成通过。

样片视觉方向许可只用于按采用方案制作。它不覆盖其他尚未审阅画面、领域准确性、配音发音听审或完整成片终审，报告 `excluded` 始终列明这些范围。实际批量制作与最终装配仍沿用项目既有审阅要求，不改变 ClapGrid 全片导出语义，也不新增审批数据库或 UI。

入口、模板、`video.md` 与证据应使用同一边界。离线回归 `tests/production-sample.test.ts` 按 [检查与验收](agents/verification.md) 采用原生 Vitest 并纳入完整 CI，使用真实短视频、受控来源演练待审、确认、复用、变更与否决；真实样片视觉判断另由用户实际观看确认。
