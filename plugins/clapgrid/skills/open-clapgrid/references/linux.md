# Linux 组件准备

由 Codex 执行命令，日常打开不要求用户手动使用终端。

1. 执行 `bash <插件根目录>/scripts/runtime-linux.sh check`。退出 0 才是组件就绪；继续主流程查询服务。
2. 退出 10 表示组件缺失或不兼容。解释将安装的组件和位置，通过宿主允许的安装审批执行同脚本 `install`。自动安装支持 glibc 的 x86_64/aarch64 Linux，跨发行版且无需管理员权限；实际已验证的平台以仓库验收记录为准。已有兼容组件逐个优先复用，只补缺少的部分。
3. 组件安装到 `${XDG_DATA_HOME:-$HOME/.local/share}/clapgrid/runtime`。`CLAPGRID_RUNTIME_HOME` 可指定组件根目录，须在所有调用及插件 MCP 环境中一致设置。Node 官方版、静态 FFmpeg/ffprobe 和 Noto Sans CJK SC 字体的版本、来源与 SHA-256 固定在安装入口。启动入口为子进程设置 PATH 与 FONTCONFIG_FILE，组件和字体不安装到系统目录。
4. 退出 11 表示不支持自动安装的 libc 或架构（如 musl、32 位或 RISC-V）；可以自行提供兼容组件后执行 check。退出 13 表示基础工具缺失、下载、校验、安装锁或安装后检查失败。报告原始原因与重试方式。基础工具包括 curl、tar、xz、sha256sum、flock、fc-list 及常用 coreutils；缺少时先准备错误中指出的工具。已完成并可用的组件会复用；安装不会启动服务或制作任务。
5. 安装与后台启动是两次独立操作。宿主拒绝任何一步时停止该操作并报告拒绝，遵守主流程的审批规则。成功安装后再次 check，核对实际 Node、FFmpeg 和 ffprobe 版本，再继续 open 和独立 workspace-status 核对。

若首次加载 MCP 时尚无 Node，组件准备后在新会话重新加载插件工具。只有新会话实际发现工具并成功查询才算 MCP 加载通过；直接执行缓存中的脚本不等同于工具发现。完整退出期间的任务保持原有独立服务语义。
