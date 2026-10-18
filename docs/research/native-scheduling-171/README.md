# 全量原生调度与职责收口（#171）

常规清单共有110文件：38个Playwright、18个Vitest、54个Node；每文件仅一个owner，预检和完整入口均从同一清单派生。历史原生快照只属于comparison-only，不进入all。完整[文件/预检范围与历史场景索引](execution-scope.json)保留1097条原历史记录的出处及迁移批次索引；其中动态导出父级是容器而非独立断言，缓存内部对照三项按#169记录替代保障，不能将原历史记录数直接当作当前独立断言数。其余新增故障场景继续由实际原生收集报告核对；本文索引不代替最终固定提交的收集报告。

迁移后的Playwright使用框架原生跨文件调度和worker池；文件内仍沿各文件既有serial/parallel设置，未将全部场景强制fullyParallel。每个worker复用一个Chrome，每次panel.check独立context/page、storage、目录及HTTP资源端口。Playwright没有新建按业务拆分的projects：当前只有一个真实Chrome channel和同一种fixture，拆分会重复初始化pool，不能提供额外隔离。纯CSS使用同一test worker，不触发Chrome fixture。Node真实进程/环境/watch/固定检出专项保留文件级串行，Vitest的18文件继续threads、单worker、fileParallelism false、isolate true；其中服务和环境恢复依赖此隔离边界。另用官方CLI临时配置，对text-search的2项逻辑与service的4项真实HTTP/SQLite场景比较threads单project、forks单project及threads双project，各三次且均单worker；临时配置不进入生产接口。最终选择及原件见measurements.json。

删除零调用的checkBrowser及其旧dumpDOM/esbuild/CSS准备入口，browser.ts只保留仍被真实fixture与历史快照使用的Chrome发现。interactive-browser仍服务四个原生对照快照，保留其调用链；这些快照的历史耗时和断言可继续复查。#163已删除无语义消费的重复Vitest JSON reporter，#169已删除无调用MemoryBuildCache和仅绑定它的内部计次测试、两份重复全构建内部投影对照。替代保障是现有真实esbuild/CSS冷/热字节、同长度依赖变化、工具/环境/选项/锁定依赖失效、损坏及半写缓存重建、权限/链接/Unicode指纹、真实浏览器与完整报告故障注入，不是只检查框架退出码。

自研职责剩余：项目唯一执行清单与严格UI范围；源码/配置/依赖/环境固定身份；执行者原始报告的完整性/逐例状态/唯一归属校验；同次预检累计及失败集中复验；工作树锁、真实拥有者取消与进程组兜底；可核对完整输入的构建准备缓存。框架负责收集/测试调度/worker池/逐例生命周期/原始报告。保留的适配职责无法由原生成功退出码证明；未并行运行不同执行者，不跨事件或历史passed自动累计，没有增加runner机器。

公开完整、固定提交、相关、UI、复验和watch入口继续进入同一分派。UI快检未知/非静态范围maxConcurrency=1的限制保留，普通完整检查不将Node生命周期并行。缺Chrome、零收集、skip/todo、only、retry、收集/未捕获错误、缺损原件、错源码/错集合、取消均沿原严格校验。Node非UI专项原有OS能力skip政策保持。真实故障与兼容开发回归原件见本轮记录；最终固定候选的完整/固定/watch链在#172执行，本文不提前声称正式通过。

构建缓存仅复用本次可核对源码/锁文件/工具/环境/选项对应的编译字节，命中仍新建隔离页面实际执行；未知/损坏输入重新构建。未新增分片或聚合捷径，总runner分钟由同一台runner实际wall-clock计算。

代表测量固定四文件九场景：audio-panel、delete-confirm-focus、panel-update-panel、wide-panel，涵盖媒体、真实焦点/键盘、构建定义、宽窄窗口；同开发candidate、同锁定依赖/Chrome/机器，关闭字节码与浏览器构建缓存，各方案连续三次，采样期间无其他CPU检查。wall-clock包括身份采集、准备、真实交互、报告、Chrome退出和资源清理；不以各例耗时相加代替端到端。每轮校验九例passed/retry0、context/目录隔离与关闭、Chrome实际退出。该代表组不证明全量CI收益，最终完整成本须由#172的实际CI原件核对。详细数字在measurements.json及本轮外部原始报告中保留。

实际代表组c1为51.869 / 52.251 / 51.568秒，中位51.869；c2为30.127 / 30.092 / 30.215秒，中位30.127，减少41.92%。每轮仍为九项相同场景、retry 0、九个独立context/page/目录，Chrome及资源实际退出。选择普通完整分派默认2，显式1仍可用；只在同一runner减少墙钟/runner分钟，不增加机器。

Vitest threads中位2.384秒，forks2.376秒（仅约0.3%差异），双project2.440秒（约慢2.4%）；保留threads单project，避免为噪声重构pool。根include默认被双project继承的首次实验实际执行12例重复，虽CLI退出0仍被独立集合验证判无效；该原件和配置保留，不计为有效样本。修正仅外部临时extends:false/root include后重新完成三轮各6例，生产配置不增加实验开关。三种方案都关闭Vitest结果排序缓存与fsModuleCache以及Node字节码；比较源配置/版本/范围和逐例结果见原件摘要。
