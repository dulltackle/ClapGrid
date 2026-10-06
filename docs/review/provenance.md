# 审查规范来源与采纳

## 前次建议稿去向

2026-10-05 的 Codex 会话 `Review GitHub comments for standards`（`01a10ef4-2fff-7973-9916-3f85528ddd9c`）记录了四份新增文件的完整正文：`CODING_STANDARDS.md`、`consistency.md`、`validation.md` 和 `retro-2026-10-05.md`（后三份原拟置于 `docs/coding-standards/`）。原会话明确未提交；本轮检查当前工作树及 Git 历史未发现这些文件，不能声称恢复了原提交。

本轮从该会话的 fileChange 正文核对提炼，原文及来源保存于本轮仓库外运行记录 `prior-review-draft.json`。历史评论抓取有 104 条、去重后 94 份的记录；这个数量是前次复盘证据，不是本轮重新查询的结果。评论作者均为同一账号，不代表多位独立评审者的共识。

## 采纳范围

依据 [#50 父规格](https://github.com/dulltackle/ClapGrid/issues/50)、[#58](https://github.com/dulltackle/ClapGrid/issues/58) 与 [ADR 0001](../adr/0001-workspace-project-binding.md)，将 C1–C6、V1–V6 中适用的判断约束提炼为 [OCR 规则](../../.opencodereview/rule.json)，按改动范围审查。规则正文只有一个权威位置；没有恢复原稿中“每次实现前读整套规范”的建议，也没有新建通用风格 lint。

| 条目 | 历史依据与适用判断 |
| --- | --- |
| C1–C2 | [#18 双服务仲裁](https://github.com/dulltackle/ClapGrid/issues/18#issuecomment-5854001347)、[#44 多面板](https://github.com/dulltackle/ClapGrid/issues/44#issuecomment-5995116127)。固定归属以 ADR 0001 为准，替代旧项目切换要求。 |
| C3–C4 | [#9 未知计费结果](https://github.com/dulltackle/ClapGrid/issues/9#issuecomment-5833392026)、[#22 配音有效性](https://github.com/dulltackle/ClapGrid/issues/22#issuecomment-5866202444)。保留请求身份与输入快照判断。 |
| C5 | [#26 清理后解锁](https://github.com/dulltackle/ClapGrid/issues/26#issuecomment-5868366978)、[#33 accepted 窗口](https://github.com/dulltackle/ClapGrid/issues/33#issuecomment-5998010658)。保持整项目锁及异步受理语义。 |
| C6 | [#25 媒体边界](https://github.com/dulltackle/ClapGrid/issues/25#issuecomment-5868010491)、[#41 迁入规格](https://github.com/dulltackle/ClapGrid/issues/41)。仅相关改动适用。 |
| V1–V4 | [#29 安装隔离](https://github.com/dulltackle/ClapGrid/issues/29#issuecomment-5875120704)、[#42 重载核对](https://github.com/dulltackle/ClapGrid/issues/42#issuecomment-5987106704)、[#47 退出前已完成](https://github.com/dulltackle/ClapGrid/issues/47#issuecomment-5995130621)。结论严格受证据范围约束。 |
| V5–V6 | [#29 媒体兼容](https://github.com/dulltackle/ClapGrid/issues/29#issuecomment-5975748610)、[#35 宿主验证](https://github.com/dulltackle/ClapGrid/issues/35#issuecomment-5968806367)。沿用面板规范，不复制样式规则。 |

机械要求复用类型检查、测试与构建；本轮补充本地审查上下文链接的确定性检查，以有效链接和删除目标后的违规输入验证退出状态。未把任务锁、收费幂等或证据是否足够等判断性规则伪装成文本匹配检查。

## 实际入口与交付边界

OCR 项目规则使用 `.opencodereview/rule.json` 自动发现，不传覆盖项目规则的 `--rule`。匹配的项目规则有意替代内置的通用风格清单，保留项目需要的行为和安全判断；不新增函数长度、命名风格等门槛。个人 `open-code-review-delegate` 技能已有逐文件规则解析与独立覆盖要求，本轮无需修改个人技能或全局配置。

真实 CLI 验证使用 OCR v1.12.10；完整 preview、rule 结果及逐项验收证据保存在本轮运行记录。自动回归检查链接有效/失效及仓库当前链接，真实 CLI 结果单独留证，不以提示词字面断言替代独立审查。历史 #48、#49、桌面首装和其他平台未验证项均保持原状态。
