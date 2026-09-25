# 媒体诊断记录（一次性对照实验）

## 复现与最小化

使用本机 Codex 内置浏览器和 cua_repl，读取可访问性树后执行原生播放按钮的 `click(5)`，再读取页面：重复得到 `This page crashed`。完整原型去掉业务逻辑成为仅一个 video 元素的页面，仍复现。可访问性节点编号每次从新树读取，不固定盲点。

最小静态服务命令：`python3 -m http.server 48762 --bind 127.0.0.1 --directory prototypes/runtime-lifecycle/media-probe`。命令仅用于诊断，不代替独立后台服务。

## 假设与结果

| 对照 | 操作 | 结果 |
| --- | --- | --- |
| 原始 H.264/AAC 经原服务 | 无障碍点击原生播放按钮 | 页面崩溃 |
| 相同 MP4 经简单静态服务 | 同上 | 页面崩溃；原服务 Range 实现不是必需触发条件 |
| 去掉音轨的 H.264 MP4 | 同上 | 页面崩溃；AAC 不是必需触发条件 |
| VP9/Opus WebM | 同上 | 页面崩溃；仅换容器/编码不足以消除无障碍点击崩溃 |
| H.264/AAC，经普通 HTML 按钮调用 play | 普通按钮点击 | 页面保留；time=0，duration=4，PIPELINE_ERROR_DISCONNECTED: video decode error |
| VP9/Opus，经普通按钮 | 普通按钮点击 | time=0.11302，PIPELINE_ERROR_DECODE: video decode error |
| VP8 无音轨，经普通按钮 | 普通按钮点击 | 完整到 4 秒；截图正常显示彩色测试画面 |
| VP8/Opus，经普通按钮 | 普通按钮点击 | 完整到 4.025 秒，无媒体错误 |
| VP8/Opus，原生控件 | 无障碍节点点击 | 页面崩溃 |
| 同一 VP8/Opus，原生控件 | 截图定位的鼠标坐标点击 | 完整播放；末帧时间戳 3.958，控件 0:04/0:04 |
| 同一原生播放器 | 实际拖动进度条 | 从结尾回到较早画面，截图视频内时间戳 1.333，滑块移到前段 |
| 完整表格 + 缓存安装脚本 + VP8/Opus 路由 | 实际鼠标播放、键盘进度定位 | 播放完成；左方向键使进度从 4 秒回到 3 秒范围；完整页面鼠标拖动受定位偏差影响，未取得可靠结果，待用户确认 |

## 日志信号与结论边界

宿主 journal 记录媒体实验期间渲染进程 `reason=crashed exit_code=4`。H.264/VP9 普通按钮实验附近还记录：

```text
nullptr returned from gbm_bo_import
CreateSharedImage: could not create backing.
Restarting GPU process due to unrecoverable error. Context was lost.
GPU process exited unexpectedly: exit_code=8704
```

这些证据将独立解码失败指向当前宿主 GPU/共享图像路径，但没有符号栈或禁用该路径的对照，不能宣称已确定具体驱动缺陷。没有修改 GPU 设置、更新客户端或降低安全限制。

无障碍节点点击和真实鼠标操作应分别记录。VP8/Opus 是已验证可用的候选预览副本，不是修复宿主本身；原始 MP4 仍保留。此前无法完成的拖动已在最小页面验证，完整页面待人工确认。音轨存在且播放器无报错不等于实际听感通过。

## 保留和复测

所有实验文件留在明确标记的 media-probe 目录。不是产品测试套件，不添加仅验证自写实现的单元测试。需要同一实际 Codex 浏览器才能复现宿主行为，普通 headless 浏览器不能代表正确回归边界。

复测顺序：打开 `vp8-native.html` → 截图确定播放按钮坐标 → 鼠标点击 → 观察完整播放 → 截图确定进度条 → 拖动 → 核对画面时间戳。不要再用无障碍 click 原生播放节点重复触发崩溃。

## 后续人工复测与归档

2026-09-25 用户在已安装插件的完整表格页面确认 VP8 播放与拖动正常，补齐上文的完整页面拖动缺口。实际音频听感仍未确认，转交 [#14](https://github.com/dulltackle/ClapGrid/issues/14)。本记录保留历史故障及归因边界，不将预览副本视为 H.264/VP9 宿主解码问题的修复。
