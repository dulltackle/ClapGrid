# 旧制作入口写出的科学记数 PAX 时间

这组追加夹具修复 #125 审查发现的兼容缺口，不修改 #123 已冻结的 v1 基线。

从 `production-archive-v1/project/` 复制原字节，只对实际普通文件 `src.ts` 分别执行 Python `os.utime(path, ns=(100,100))` 与 `os.utime(path, ns=(-100,-100))`。在旧源码提交 `cd8b4df863541e596c0690e4368e5d1ba3216281` 的工作树中，通过 `node scripts/production.mjs pack` 调用真实旧 Python writer，再经同一旧统一入口 `verify-package` 核对通过。`catalog.json` 保存完整命令、cwd、旧源码摘要、实际环境、旧报告及成员原字节身份。

两个固定包的实际 PAX mtime 分别为 `1.0000000000000001e-07` 和 `-9.999999994736442e-08`；这些实际浮点文本来自旧 writer。成员和 v1 索引字节保持原身份，只有文件元数据不同。日常 Node 入口测试读取固定包及来源记录，无需 Python，不由新 writer 生成 expected。

真实文件系统时间源是有限整数纳秒，不能产生 NaN 或 Infinity；坏 PAX 时间 `NaN`、`Infinity`、溢出 `1e400`、不完整指数和后缀垃圾仍须拒绝。已实际核对的追加来源仅为 catalog 记录的本机环境，不泛化至其他平台或 Python 小版本。
