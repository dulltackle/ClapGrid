# Node 归档迁移可行性评估

评估日期：2026-10-13（America/Los_Angeles）。源码基线：`1b2f1792d7176fae2642087e4e2af52267825f67`。本文件是方案评估，尚未迁移实现，也不是指定提交的正式验收；遵守 [ADR-0003](adr/0003-verification-evidence-boundary.md) 对证据适用范围的要求。

## 结论与范围

统一到 Node 有可行路径，本轮样本已验证双向读写及严格校验补足的可能性。SHA-256、顺序流处理、gzip 完整性核对、候选文件发布都没有必须保留 Python 的技术障碍；主要成本是复刻项目比通用 tar 读取器更严格的规则，以及保住旧包的格式与索引兼容。仅把 Python 子进程换成 npm tar 调用，不能保持当前归档校验能力。建议按中等偏大的兼容迁移安排，先固定旧包夹具与格式范围，再做 Node 实现与真实命令回归。

本轮目标仍是保持制作入口行为：作者明确声明 `files`；项目文件引用不自动等于入包成员；报告保护与归档必需集合分别保留用途规则；归档成功不提升人工审阅结论。用户随后选定 Node 统一、优先采用 `tar-stream` 并继续使用 v1 索引，兼容范围与逐项决定见 [ADR-0004](adr/0004-node-production-archive.md)；以下选项比较保留评估时的依据。本评估不承诺 gzip 输出字节与 Python 完全相同。

本评估保留迁移前的调查事实与结论；下列 Python 链接指向冻结原始实现，现行 Node 日常操作与兼容边界见 [制作交付包](production-package.md)。

迁移前说明与实现分别见 [制作交付包](production-package.md)、[archive.py](../tests/fixtures/production-archive-v1/legacy/archive.py)、[Node 调用入口](../scripts/production/package-common.mjs)。现有 Python 实现已经额外补了严格 tar 文件头、第二个结束零块、结束后数据和 gzip 读至末尾检查；这些项目规则必须跟随迁移。

## 能力对应

| 现有能力 | Node 路径 | 评估与条件 |
| --- | --- | --- |
| 顺序读取成员、逐个 SHA-256 与大小核对 | Node 文件流、`node:crypto`、tar 成员流 | 保留逐成员完整消费与 `seen` 集合；缺失、重复、额外成员仍由归档 module 判断 |
| gzip CRC、长度及截断检测 | `createGunzip()` 默认结束策略 | 读至压缩流结束，等待整条 pipeline 完成；不能在 tar 成员读取结束时提前报告通过 |
| 严格文件头与正文完整性 | tar parser 加项目严格核对 | 两个候选库都不能独立保证现有全部规则 |
| 两个结束零块、结束后全零填充、拒绝追加成员 | 对解压后的原始 tar 流检查 | 必须保存这个独立事实，不能把 parser 的 `finish` 当作证明 |
| 路径规范、项目内实际文件、链接与保留名检查 | `node:path`、`node:fs` | 保留词法路径与实际路径检查；不能用 tar 库的自动修正或跳过代替失败 |
| 候选校验后替换，失败保留旧包与候选位置 | 在输出目录排他创建候选，关闭并复验后 `rename` | POSIX 同一文件系统可保持原子替换语义；不能退化为删除旧包后复制 |
| 清单原始字节与索引身份 | 保存原始清单 Buffer，明确旧索引兼容策略 | 是迁移的实质风险，不能只比较解码后的 JSON 含义 |

Node 22.13.0 官方文档说明默认对截断压缩输入报错，而 `finishFlush: Z_SYNC_FLUSH` 会放弃这一完整性判断；内置 zlib 源码检查 gzip trailer 的数据校验值与解压长度。因此在保持默认设置且完整消费的前提下，可沿用 Node 内置实现。[zlib 文档](https://raw.githubusercontent.com/nodejs/node/v22.13.0/doc/api/zlib.md)、[内置 inflate 源码](https://github.com/nodejs/node/blob/v22.13.0/deps/zlib/inflate.c#L1182-L1228)

`stream/promises.pipeline` 的 Promise 在整条流完成后结束，并传播流错误、清理失败的流。归档 module 还须等待每个成员的摘要核对完成，处理成员回调异常与背压，成功时消费到 EOF；不能只监听最后一个成员的 `end`。[Node Stream 文档](https://nodejs.org/download/release/v22.13.0/docs/api/stream.html#streampipelinesource-transforms-destination-options)

Node 提供 `fsPromises.rename`；POSIX 规定覆盖时目标名称始终指向旧文件或新文件，并列出跨文件系统的 `EXDEV` 失败。在输出目录内创建候选可以避免普通跨文件系统移动。这个保证是名称替换的原子性，不额外声称断电持久性；其他支持平台仍要实际回归。[Node 文件文档](https://nodejs.org/download/release/v22.13.0/docs/api/fs.html#fspromisesrenameoldpath-newpath)、[POSIX rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)

## tar 依赖选项

下面比较本次核对的固定版本，不承诺未来版本行为不变。Node 文档选择项目最低版本 22.13.0；实验运行版本另列。

| 选项 | 适合之处 | 仍需承担的成本 |
| --- | --- | --- |
| `tar-stream@3.2.2` | 围绕成员流读写，不要求展开归档到文件系统；适合自己控制成员选择与发布 | 额外实现严格流结束规则、文件读取策略与完整性编排；PAX/GNU 扩展及旧包接受面要逐项核对 |
| `tar@7.5.22` | 有创建、列表、展开等完整能力；`strict: true` 可把可恢复警告升级为错误 | 不能凭 `strict` 保证结束后数据拒绝；高层默认路径修正、目录递归、链接处理等行为需控制，避免偏离显式成员策略 |
| 自行实现完整 tar 编解码 | 不增加 tar 依赖 | PAX、长路径、数字编码及历史格式全部由项目长期维护；成本最高，本轮不建议 |

`tar-stream` 源码中，解码到零块时继续读取；最终只检查未完成成员长度和缓冲是否清空，未要求出现两个结束零块。因此“成功枚举成员”不足以通过项目严格校验。它也会解释 PAX 和 GNU 长路径扩展，不能把扩展头简单当作普通文件拒绝。[tar-stream extract.js](https://github.com/mafintosh/tar-stream/blob/v3.2.2/extract.js#L132-L288)、[headers.js](https://github.com/mafintosh/tar-stream/blob/v3.2.2/headers.js)

`tar` 的 `strict` 升级既有警告；其 parser 识别两个零块后设置 `SAW_EOF`，后续解析循环停止。严格尾数据判断不能依赖该开关。直接喂压缩输入还会触发库自己的解压策略，宜将 gzip 完整性和项目 tar 流约束显式纳入归档 module。[tar README](https://github.com/isaacs/node-tar/tree/v7.5.22#warnings-and-errors)、[parse.ts](https://github.com/isaacs/node-tar/blob/v7.5.22/src/parse.ts#L162-L261)、[解析循环](https://github.com/isaacs/node-tar/blob/v7.5.22/src/parse.ts#L595-L659)

两个包都带传递依赖，不能简单称为“一个小依赖”：`tar-stream@3.2.2` 声明 `b4a`、`bare-fs`、`fast-fifo`、`streamx`；`tar@7.5.22` 声明 `@isaacs/fs-minipass`、`chownr`、`minipass`、`minizlib`、`yallist`。应锁定版本并随项目依赖正常维护。[tar-stream package.json](https://github.com/mafintosh/tar-stream/blob/v3.2.2/package.json)、[tar package.json](https://github.com/isaacs/node-tar/blob/v7.5.22/package.json)

方向建议是优先采用 `tar-stream` 与 Node 内置 gzip 继续验证，并保留项目自己的严格校验。本轮互通样本支持这个方向，最终选择仍取决于更完整的旧包夹具；不同时长期维护两个 tar adapter。这样归档 module 的 interface 仍表达完整制作操作，把顺序、错误与发布知识留在其 implementation 内，提高 depth、locality 与调用方 leverage；只有实际需要替换的 tar 实现才形成内部 seam。

## 兼容问题必须分开判断

1. **已有制作包能继续核对**：应以 Python 生成的真实样例交给 Node，再用 Python 核对 Node 生成的样例。覆盖中文、长路径、PAX、空文件和大小边界。
2. **完整输入接受面完全相同**：比一般旧包互通更强。当前 Python `TarInfo.isfile()` 还接受连续文件 `7` 与 GNU sparse `S`，不是只有普通 `0`。`tar-stream` 把 `7` 暴露为 `contiguous-file`，未知 `S` 的类型为 `null`，默认还拒绝不带 USTAR/GNU magic 的历史格式；`tar` 的成员流把不支持的类型设为忽略。尚未证明这些行为全部等价，不能让不支持的成员悄悄消失。[Python tarfile 源码](https://github.com/python/cpython/blob/v3.14.4/Lib/tarfile.py)、[tar-stream 类型解析](https://github.com/mafintosh/tar-stream/blob/v3.2.2/headers.js#L86-L185)、[tar ReadEntry](https://github.com/isaacs/node-tar/blob/v7.5.22/src/read-entry.ts#L47-L72)
3. **索引身份**：当前 `entries()` 重新序列化 `.clapgrid-package.json` 并核对其字节摘要；Python JSON 浮点表示、数字形状键的顺序等不能由 JavaScript `JSON.stringify` 自动复刻。迁移要明确旧格式兼容办法，不能默默改为宽松语义比较。

后续隔离探针通过真实制作入口生成并验证了含以下 `files` 扩展字段的旧包：`1.0`、`9007199254740993`、合法 JSON 数字 `1e400`，以及按 `10`、`2` 顺序出现的数字形状键。旧索引分别保留浮点形状、大整数、键顺序，并将溢出浮点写成 `Infinity`；这些情况属于“旧工具成功生成且验证通过”的兼容范围，不能仅以普通 `JSON.parse` / `JSON.stringify` 处理。

严格 v1 兼容需要从原清单字节保留整数与浮点区别、整数精度和对象插入顺序，再按旧序列化规则生成索引；无损读取本身不足以复刻 Python 的浮点表示，重复键及已有 `size` 字段的覆盖位置也需要保留。所有有限浮点值及 Python 3.12/3.13 的跨版本一致性尚未验证。新包采用 v2 可以另定未来规则，但不能省掉已承诺的旧 v1 兼容路径，还会增加版本分派与回归范围。

对当前写包路径的物理头探针进一步确认：普通英文、中文、长路径和具有空洞的普通文件均写出普通文件头及必要的局部 PAX 扩展，不生成 GNU sparse。相同 inode 的多路径可能写出硬链接，但原验证会拒绝，不能成功发布。PAX 覆盖字段仍须按格式处理，不能只支持探针观察到的 `path` 与 `mtime`。这些事实来自当前实现及本机 Python 3.14.4，不构成全部历史运行版本的穷尽证明。

以上区分避免用“tar.gz 标准格式”掩盖项目自身的索引规则。若最后需要收窄特殊格式或更改索引校验含义，应先形成明确决策，不算保持行为的重构。

## 迁移成本与完成条件

范围相对集中：目前归档 Python 实现为 221 行；生产调用只有 Node 入口启动该脚本。归档测试有 5 处 Python 调用承担查看、改写坏包与恢复，需要一并替换，才能让日常运行和相关测试都不依赖 Python。历史制作目录中的 Python 文件属于已经保存的制作成果，不应为语言统一而删除。当前插件 bundle 不包含制作归档脚本，本轮讨论不是插件安装更新。[归档实现](../tests/fixtures/production-archive-v1/legacy/archive.py)、[归档测试](../tests/production-package.test.ts)、[插件构建](../scripts/build-plugin.mjs)

| 工作包 | 相对成本 | 完成条件 |
| --- | --- | --- |
| 固定旧格式与坏包夹具 | 中 | 留下独立生成的 Python 旧包，覆盖索引字节、中文/PAX/长路径、特殊类型与损坏组合；不能只让新 writer 与新 reader 相互证明 |
| Node 归档与严格 tar 流校验 | 中偏大 | 保留完整流消费、逐成员摘要、两结束块与尾数据约束、失败传播、候选复验及发布失败语义 |
| 集中项目文件引用解释 | 中 | 制作卡、素材、当前审阅版本的引用知识集中；报告保护的历史/未知字段与归档必需用途差异不丢失 |
| 去除测试执行依赖及收尾 | 中 | 替换 5 处 Python 测试调用、更新运行说明、跑定向回归，再按目标提交执行正式验收 |

综合属于中等偏大、包含明确兼容风险的重构，不是对 221 行代码的机械翻译。最不确定的是索引字节兼容和完整 tar 输入接受面；应先用兼容夹具压缩不确定性，再实现。若要求逐一复刻 Python 历史格式和任意 JSON 扩展值行为，成本会上升；若决定收窄，则须记录这是明确的行为调整。

不建议在日常命令中长期保留 Python 回退，否则两套运行环境和领域知识仍需维护。迁移期间可用旧脚本作离线对照，以固定夹具持续保留证据，完成后移除运行时依赖。测试通过归档 module 的正式 interface 验证可观察结果；这使 seam 上的测试同时约束正确调用方式。

## 本轮证据与未证实项

- 本机环境：Node `v22.23.3`、Python `3.14.4`。项目最低 Node 版本是 `22.13.0`，因此本机通过不能代替最低版本测试。
- 原 `tests/production-package.test.ts` 的 38 项回归全部通过，约 10.9 秒；日志 `/tmp/clapgrid-node-archive-baseline.log`。这证明当前基线可运行，没有证明尚未实现的 Node 迁移正确。
- 索引序列化探针已确认 Python 与 JavaScript 对扩展值 `1.0` 和数字形状键 `10`、`2` 的处理会导致字节不同。旧索引需兼容策略。
- 在 `/tmp/clapgrid-node-archive-eval/` 完成 20 个样本的独立流式探针：Python 原 `verify()`，对照 Node `createGunzip()`、候选 parser 和成员名/类型/摘要/大小检查；其中 3 个有效、17 个无效。结果见该目录 `results.json`，生成与执行代码为 `fixtures.py`、`probe.mjs`、`write-probe.mjs`。
- 尚未完成：迁移实现、完整接受面等价证明、目标平台矩阵、大文件资源占用验证、指定提交正式验收。当前没有宣称源码迁移完成、安装包更新或实际宿主验收通过。

| 实验方案 | 与 Python 原校验通过/拒绝结果一致 | 观察到的差异 |
| --- | --- | --- |
| `tar-stream@3.2.2` 加成员核对 | 18/20 | 错误接受缺失结束零块、只有一个结束零块 |
| `tar@7.5.22`、`strict: true` 加成员核对 | 16/20 | 除上述两项，还错误接受结束后的非零数据、结束后追加成员 |
| 两者分别加临时严格结束检查 `EndGuard` | 均为 20/20 | 在本轮样本范围内恢复通过/拒绝结果一致；错误消息文本不要求相同 |

两种 Node parser 都拒绝本轮 gzip CRC 损坏、gzip 截断、摘要篡改、缺失/重复/额外成员等样本。Python 生成的 PAX 包含 18 层中文目录构成的长路径、约 1.2 MB 成员和空文件，Node 能读取并核对；`tar-stream` 生成同一成员集合后，原 Python `verify()` 通过。

`EndGuard` 只是可丢弃实验实现：按本次 USTAR/PAX 普通八进制 size 识别成员与结束区，没有覆盖 PAX size override、GNU sparse 或全部 tar 接受面；不能直接当生产实现。`20/20` 表示这批样本判定一致，不是完整格式等价。上述互通也没有替换生产 CLI、覆盖完整索引生成、原子发布故障或最低 Node 版本；这些仍是迁移完成条件。
