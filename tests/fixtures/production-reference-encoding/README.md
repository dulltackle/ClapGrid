# 旧证据 JSON 编码与常量独立来源

此目录在 #124/#125 的接缝修复前由旧统一制作入口实际生成并核对。日常测试只读取固定字节，不执行 Python 生成器，不依赖新 Node 写包器生成预期。

`catalog.json` 固定旧树提交 `cd8b4df863541e596c0690e4368e5d1ba3216281`、原统一 Node 入口/公共读取/旧归档调用/旧 Python 实现 SHA-256、生成器 SHA、实际命令、退出状态、完整原报告、Node 与 Python 版本及平台；旧代码主体来源为 `a55109aa0e93dc3b9d2e5b6f126607adb86d592d`，#123 只增加独立夹具。每个项目的 UTF8 普通清单显式声明全部当前必需成员，证据保留实际原始编码与特殊数值文本。

三十四组包括 UTF8、UTF8 BOM、UTF16/UTF32 的大/小端及有/无 BOM、Python 输出的 NaN/Infinity/-Infinity，以及旧 `surrogatepass` 实际接受的 UTF8 编码孤立代理字符。非 BMP 字符参与原件名称，常量名称也出现在普通字符串里，供检查解码和严格常量词法区分。基础编码与常量组的版本字段采用领域字符串，数值常量在未知扩展中出现；另以实际旧成功包固定既有reader接受的版本值比较：超安全整数精度、两个孤立代理字符的区分、字符串与常量、int/float/bool、缺省与null、数组/字典结构和标量/嵌套NaN差异，以及UTF8/UTF32独立surrogate码点与有效标量的区别（含嵌套版本及对象key）；UTF16原始合法pair与JSON转义pair仍按旧读取合并为标量。另三组固定原始 surrogate 键与转义键交错重复时的最后赋值，包括当前、历史和嵌套历史版本；新增组通过生成器的 `--cases` 参数追加，原代际来源和包字节保持不变。证据可读取不代表领域格式合格、人工来源可信或审阅通过。

每组的两个包分别由真实 Python 3.14.4 与 Python 3.12.13 子进程通过旧 Node 统一入口 pack，再通过同一旧入口 verify-package 通过。实际环境为 Linux x86_64；Windows/macOS、其他 Python 版本未执行。每个文件、原清单及归档的大小与 SHA-256 保存在 catalog。UTF16/32 原始字节不得转为 UTF8 后用来核对内容身份。

此生成器仅供离线追溯与明确重采样；重采样会改变 gzip 时间元数据以及来源记录，必须先保留旧夹具并独立审查。复现参数按真实位置填写：

```sh
python3 -B tests/fixtures/production-reference-encoding/generate.py --old-tree /实际旧统一入口工作树 --minimum-python /实际Python3.12.13/bin/python3.12 --logs /外部离线生成日志
```

日常入口回归为 `tests/production-reference-encoding.test.ts`。这些包不修改 #123 的冻结 `production-archive-v1` catalog 或历史制作原件；索引无损和原始身份继续由归档模块负责，引用模块只解释证据领域投影。
