# 旧 Python v1 独立归档基线

这组夹具为 #123 在迁移前离线固定，用于约束 #122 的 Node 实现。预期内容来自旧实现与原始文件，不由新的写包器或读包器生成。日常检查只读取固定文件，不能执行 `generate.py` 或 `legacy/archive.py`；冻结脚本是来源与复现材料，不是运行回退。

旧源码来自 `a55109aa0e93dc3b9d2e5b6f126607adb86d592d:scripts/production/archive.py`，未经修改复制到 `legacy/archive.py`。`catalog.json` 保存源码 SHA-256、生成器 SHA-256、实际生成命令、Python 版本及平台，记录旧 `pack`/`verify-package` 返回。`identities` 固定每个归档、索引和原项目文件的大小与 SHA-256；`success.members` 是旧 `entries()` 对原字节得出的预期身份。

- `project/` 保存原清单与所有原件。`expected-index.json` 是旧序列化结果，包含合法清单中的 `1e400`/`-1e400` 溢出后输出的 `Infinity`/`-Infinity`，应作为字节读取，不能用标准 `JSON.parse` 读取。原清单没有 `NaN`/`Infinity` 字面量，能通过现有 Node 入口读取。
- `valid.tar.gz` 由本机 Python 3.14.4 的真实旧制作归档命令生成并原核对通过；`valid-python-3.12.tar.gz` 由最低声明版本 Python 3.12.13 的同一旧命令生成，由本机旧核对再通过。两版本重建的索引字节相同。压缩包元数据含生成时间，重生成不承诺压缩字节不变。
- `pax-overrides.tar.gz` 使用独立 Python `tarfile` 基于原成员重写，经两个版本的原核对通过。除了中文长路径，还固定 `size`、`uid`、`gid`、`uname`、`gname`、`mtime` 的有效局部 PAX 覆盖；普通头 `size=0`，PAX `size=13`，故忽略 PAX 会失去正文并失败。默认旧包本身也实际包含 `path`/`mtime` PAX。
- `corrupt/` 保存成员、字节、文件头/正文、gzip CRC/ISIZE/截断、结束零块和尾部等独立变体。`catalog.corrupt` 也包含零尾及连续流的成功对照，消费方使用 `requiredStatus`，不能把全部变体一概视为失败。每项保存确切构造依据、旧结果与规定结果。

数字与字节基线覆盖任意精度整数、浮点整数、负零、科学计数法阈值、非标准溢出输出、数字形状键顺序、嵌套扩展、重复键最后值覆盖且保留首次位置、已有 `size` 原位置覆盖、Unicode/emoji、转义、两空格缩进及单终止换行。归档保留空文件、普通文件与超过传统头长度的中文路径。

尾部对照遵守既有完整性语义：旧工具接受 gzip 后全零原始字节、空第二流以及仅产生 tar 零尾的第二流；旧工具拒绝非零尾、第二流非零明文、第二流 CRC 损坏、零尾之后的垃圾与损坏第二流。Node 必须继续核对全部流，不能在遇到首零字节后忽略剩余压缩数据。损坏 PAX 必须拒绝；不能用通用 tar 的容错降低父规格要求。

本次仅实际验证 Linux x86_64 上 Python 3.12.13 与 3.14.4；其他 Python 小版本、Windows/macOS 未验证。有限扩展数值样本不证明所有浮点值均跨版本等价。

迁移期间需要重新采样时，先保留旧夹具与来源记录，再显式执行（路径以实际环境为准）：

```sh
python3 -B tests/fixtures/production-archive-v1/generate.py --compare-python /path/to/python3.12
```

生成器调用冻结旧命令的 stdin JSON 接口，读取真实项目文件并保存原返回，再用独立 `tarfile` 构造坏包。重生成会更新内容身份与来源记录，必须重新审查；这些命令不属于 npm 日常检查链。日常断言为 `tests/production-archive-baseline.test.ts`；供入口测试消费的只读目录与类型接口为 `tests/helpers/archive-baseline.ts`。
