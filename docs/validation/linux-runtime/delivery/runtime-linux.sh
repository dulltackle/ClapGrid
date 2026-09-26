#!/usr/bin/env bash
# Ubuntu 原型组件入口；安装仅由显式 install 操作触发。
set -u
set -o pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
action=${1:-check}
if (( $# > 0 )); then shift; fi

ready() {
  command -v python3 >/dev/null 2>&1 &&
    python3 -c 'import sys; import http.server, urllib.request; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1
}

missing() {
  echo '运行组件缺失或不兼容：需要 Python 3.9 以上及标准库。本次未启动服务；可由 Codex 经宿主审批执行 install 后重试。' >&2
  exit 10
}

case "$action" in
  check)
    (( $# == 0 )) || { echo 'check 不接受额外参数。' >&2; exit 2; }
    ready || missing
    python3 --version
    ;;
  install)
    (( $# == 0 )) || { echo 'install 不接受额外参数。' >&2; exit 2; }
    if ready; then
      echo '运行组件已就绪，跳过安装。'
      python3 --version
      exit 0
    fi
    # 此安装路径只验证 Ubuntu 24.04；其他发行版由独立方案处理。
    if [[ ! -r /etc/os-release ]]; then
      echo '无法识别系统，未安装组件。' >&2; exit 11
    fi
    . /etc/os-release
    if [[ ${ID:-} != ubuntu || ${VERSION_ID:-} != 24.04 ]]; then
      echo '自动安装目前只支持 Ubuntu 24.04；此系统未执行安装。' >&2; exit 11
    fi
    elevate=()
    if (( EUID != 0 )); then
      if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
        echo '组件安装需要系统管理员权限。请通过宿主允许的系统认证后重试；未安装组件，本次未启动服务。' >&2
        exit 12
      fi
      elevate=(sudo -n)
    fi
    if ! "${elevate[@]}" apt-get update -o APT::Update::Error-Mode=any -o Acquire::Retries=0 -o Acquire::http::Timeout=15 ||
       ! "${elevate[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3; then
      echo '运行组件安装失败，本次未启动服务。请保留上方错误，解决网络、包管理器或权限问题后重新执行 install；不会自动启动或重试任务。' >&2
      exit 13
    fi
    ready || { echo '安装命令结束，但 Python 检查未通过；本次未启动服务。' >&2; exit 13; }
    echo '运行组件安装完成。请由 Codex 经宿主允许的方式执行 start，并在另一次调用中检查 status。'
    python3 --version
    ;;
  start)
    ready || missing
    exec python3 "$script_dir/prototype.py" "$@"
    ;;
  status)
    ready || missing
    exec python3 "$script_dir/runtime_status.py" "$@"
    ;;
  *)
    echo '用法：bash runtime-linux.sh check|install|start|status；start/status 可带 --port 与 --project。' >&2
    exit 2
    ;;
esac
