# 添加与焦点场景原生执行（#166）

初始基线为 `81ff4eb4c55082f0d21ceb659645e6e29d5d5502`。本批准确覆盖7文件98个既有场景：相对添加22、相对添加生命周期10、普通添加焦点27、片段焦点23、详情焦点12、删除确认焦点1、弹窗3。保留dialog文件本身原有的窄矮导出设置弹窗断言，不额外迁移媒体/导出面板或特殊构建文件。

[逐场景映射](focus-native-166-map.json) 对应每个原文件/名称、原scope及候选原生位置。迁移仅替换测试注册、旧helper import和fixture调用；AST逐一核对所有模板字面量不变，覆盖动态body、scenario/action/assertion字符串、迟到响应矩阵、人工帧调度及fixture.replace。原浏览器脚本、断言、真实键鼠、焦点移动、跨渲染更新、弹窗开关和交互顺序原样保留，没有新增直接DOM修改或固定等待替代原操作。

## 隔离、清理与公共门禁

沿用已经实际验证的Playwright fixture，每个worker复用自己的真实Chrome，每例新建context/page、DOM/storage、选择与焦点状态及临时目录。原业务替身仍位于HTTP client边界，场景模块状态随新页面重建；本批不需要额外后台服务。保留生产同源样式及原视口：1200×800、420×420、360×320、1600×1000及各文件原默认。原15/40秒上限显式改为test.setTimeout，不放宽超时，不增加retry。

清单仅切换7处executor，all/rows/policy字段原样；完整PR和原UI相关计划仍引用相同文件身份，不再由Node重复归属。无样式证明或扩大范围的既有UI计划保守并发1，本批通过公开定向入口实际采用1，不因CLI允许请求2而绕过安全政策；并发收益留给#171。

缺Chrome改由原生fixture直接失败，去掉旧skip/宿主Chrome判断及本批不再使用的Node/interactive helper imports。其他批次仍调用interactive-browser与旧浏览器helper，因此保留其代码。成功、失败、取消、资源marker和严格UI完整性保障沿#163/#165已经验证且本批未修改的fixture、资源registry和校验器承接；最终固定候选还须执行完整适用回归。

## 实际执行与代表热点

本批通过公开`test-runner.mjs --suite ui --files [...] --concurrency 1`实际执行全部原场景并保存官方原生JSON、逐例文件/位置/版本/nonce、timings及源码前后身份。类型检查和开发定向不是最终固定提交验收；测试后补齐的文档/映射不伪装成重新执行。

代表热点选择完整relative-insert-lifecycle-panel的10例和delete-confirm-focus的1例，保留相对添加失败/来源恢复、旧响应失效、修改权/锁规则及动态禁用焦点等完整覆盖，所选两个文件不选掉任何场景。优化前已完成三次，使用同一公开命令、并发1、关闭Node字节码与浏览器构建缓存、相同BROWSERSLIST环境，并由协调者预留无并发检查窗口。用户明确续时60分钟后，候选固定在75ce6a5，按原命令与静默窗口完成三次后测。记录准备、交互和清理观察段，入口wall-clock含完整身份、实际执行、报告与收尾；观察段不能任意相加冒充端到端占比。

公开类型检查通过；7文件98原场景实际全部passed、retry 0。实际并发1，98个context/page/目录分别独立且全部收尾，实际宿主精确worker/Chrome身份与目录状态记录在166-final-host-observation.json。

旧代表组11例完整三次为 35.966 / 36.275 / 36.318 秒，中位 36.275 秒。每轮串行用例观察值之和的三次中位分别为：bundleMs 3088.9ms；stylesMs 10192.9ms；chromeStartupMs 2250.0ms；interactionMs 17426.2ms；cleanupMs 1837.0ms。这些helper观察段不是完整入口占比，不包括所有外层收集/身份/报告开销，不用于推定候选收益。

候选三次完整公开入口为31.997 / 34.013 / 35.005秒，中位34.013秒；相对旧中位36.275秒下降6.24%。样本范围31.997–35.005秒，存在明显离散，不能将这一小组外推为全批或CI稳定收益。各轮11例完整passed、retry0、单worker、Node字节码及bundle/CSS准备缓存实际关闭，原生nonce独立；逐例bundle/styles及视口身份与旧组一致，Chrome/worker/context/目录实际收尾。

原始报告/日志与样本通过[汇总及保全索引](check-161/README.md)保存，保留原提交、时间和来源，不把开发/代表组证据升级为最终固定提交正式验收。该组不等于98场景全批或完整PR性能；不将不同覆盖、不同runner的历史耗时相减制造收益。
