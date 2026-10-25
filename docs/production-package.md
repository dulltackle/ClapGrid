# 制作交付包

先运行项目媒体检查及对应审阅记录核对，再生成并核对交付包：

```sh
npm run production -- pack --project '/路径/项目' --output delivery.tar.gz
npm run production -- verify-package --project '/路径/项目' --archive delivery.tar.gz
```

归档通过只证明文件完整性，不判定人工确认；`pending`、受控测试、既有确认及对应范围都原样保存，不能因打包成功改成通过。

## 清单成员

在 `production.json` 增加非空 `files` 数组，成员来自实际清单，不固定数量：

```json
{
  "files": [
    { "path": "src/动画.tsx", "sha256": "实际文件的64位小写SHA-256", "category": "production" },
    { "path": "evidence/技术检查.json", "sha256": "实际文件的64位小写SHA-256", "category": "technical" },
    { "path": "evidence/用户确认.json", "sha256": "实际文件的64位小写SHA-256", "category": "user" },
    { "path": "evidence/旧版待审.json", "sha256": "实际文件的64位小写SHA-256", "category": "history" }
  ]
}
```

`production` 是制作内容，`technical` 是技术证据，`user` 是人工审阅记录，`history` 是历史原件；分类只描述文件用途，不表示记录内容已验收。成员须是项目内普通文件。

清单应包含类型配置、每个口播片段的制作卡、源文件、配音、装配和审阅素材，以及片段声明的 `assets`、`lastFrame`、`transitions`、样片视频与采用方案、证据、依赖路径和已有 `video.md`。证据中能定位到项目内文件的产物与证明原件也须列入；外部网页或聊天指针、尚未生成的待审产物及已失效历史路径不强制存在。锁文件、字体、共享源码、参考素材和历史记录由作者按实际使用列入。清单自身不列入 `files`，交付输出也不能设为清单或成员路径。

## 兼容与恢复

旧包兼容范围是既有 ClapGrid 成功生成且原核对通过的 v1 交付包，不承诺 Python 读取器接受的全部历史 tar 格式。离线旧实现、生成器及固定旧包保留于 `tests/fixtures/production-archive-v1/`，作为可追溯基线，不在日常命令中执行；兼容回归须使用独立旧包夹具，新写包与新读包往返不能作为唯一兼容证据。

恢复时先用原清单执行 `verify-package`，再在空的独立目录展开，恢复后再次核对并通过 `check` 检查实际媒体及配音对应。恢复可播放不替代用户听审、视觉判断和完整成片终审；真实宿主素材关联及全片导出另采实际证据。
