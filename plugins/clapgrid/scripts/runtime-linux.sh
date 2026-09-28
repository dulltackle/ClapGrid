#!/usr/bin/env bash
# Linux 正式插件组件入口；只有显式 install 才安装，只有 start 才启动后台服务。
set -u
set -o pipefail
script_dir=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd) || exit 1
plugin_dir=$(cd -- "$script_dir/.." && pwd) || exit 1
runtime_home=${CLAPGRID_RUNTIME_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/clapgrid/runtime}
action=${1:-check}
if (( $# )); then shift; fi
node_bin=''

node_ready() {
  local candidate
  for candidate in "$(command -v node 2>/dev/null || true)" "$runtime_home/node/bin/node"; do
    if [[ -n $candidate ]] && "$candidate" --input-type=module -e '
      const [major, minor] = process.versions.node.split(".").map(Number);
      if (major < 22 || (major === 22 && minor < 13)) process.exit(1);
      await import("node:sqlite");
    ' >/dev/null 2>&1; then node_bin=$candidate; return 0; fi
  done
  return 1
}

media_ready() {
  local encoders filters encoder fonts
  fonts=$(fc-list :lang=zh family 2>/dev/null) || return 1
  [[ -n $fonts ]] || return 1
  command -v ffprobe >/dev/null && ffprobe -version >/dev/null 2>&1 || return 1
  encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null) || return 1
  for encoder in libx264 mpeg4 libvpx libvorbis ffv1 aac; do
    [[ $encoders =~ [[:space:]]$encoder[[:space:]] ]] || return 1
  done
  filters=$(ffmpeg -hide_banner -h filter=subtitles 2>/dev/null) || return 1
  [[ $filters == *wrap_unicode* ]]
}

missing() {
  echo '运行组件缺失或不兼容：需要 Node.js >=22.13（含 SQLite）、FFmpeg/ffprobe（含视频编码与字幕自动换行）、Fontconfig 及中文字体。本次未启动服务；由 Codex 经宿主许可执行 install 后重试。' >&2
  exit 10
}

install_failed() {
  echo "组件安装失败：$*。本次未启动服务；解决上述问题后重新执行 install。" >&2
  exit 13
}

case "$action" in
  install)
    (( $# == 0 )) || exit 2
    if node_ready && media_ready; then
      echo '运行组件已就绪，跳过安装。'
      exit 0
    fi
    [[ -r /etc/os-release ]] || { echo '无法识别发行版，未安装。' >&2; exit 11; }
    . /etc/os-release
    [[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] || {
      echo '自动安装仅支持 Ubuntu 24.04；其他 Linux 可提供兼容组件后执行 check。' >&2; exit 11;
    }
    case "$(uname -m)" in
      x86_64) arch=x64; digest=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de ;;
      aarch64) arch=arm64; digest=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f ;;
      *) echo '自动安装仅支持 x86_64/aarch64。' >&2; exit 11 ;;
    esac
    for tool in curl tar xz sha256sum mktemp mkdir mv rm flock; do
      command -v "$tool" >/dev/null || install_failed "缺少基础工具 $tool，请由宿主许可的系统包管理安装 curl、ca-certificates、xz-utils、util-linux 与 coreutils"
    done
    mkdir -p -- "$runtime_home" || install_failed '无法创建组件目录'
    exec 9>"$runtime_home/install.lock" || install_failed '无法打开安装锁'
    flock -n 9 || install_failed '另一个组件安装正在进行，请等待其完成'
    if ! node_ready; then
      temporary=$(mktemp -d "$runtime_home/.install-XXXXXXXX") || install_failed '无法创建下载目录'
      trap 'rm -rf -- "$temporary"' EXIT
      archive="node-v22.23.3-linux-$arch.tar.xz"
      curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 \
        "https://nodejs.org/dist/v22.23.3/$archive" -o "$temporary/$archive" || install_failed 'Node 下载失败'
      (cd -- "$temporary" && printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -) || install_failed 'Node 摘要校验失败'
      tar -xJf "$temporary/$archive" -C "$temporary" || install_failed 'Node 解压失败'
      "$temporary/node-v22.23.3-linux-$arch/bin/node" --input-type=module -e 'await import("node:sqlite")' >/dev/null 2>&1 || install_failed '下载的 Node 无法运行'
      if [[ -e $runtime_home/node || -L $runtime_home/node ]]; then
        mv -- "$runtime_home/node" "$runtime_home/node.invalid.$$" || install_failed '无法保留旧组件'
      fi
      mv -- "$temporary/node-v22.23.3-linux-$arch" "$runtime_home/node" || install_failed '无法发布 Node 组件'
    fi
    if ! media_ready; then
      elevate=()
      if (( EUID != 0 )); then
        if ! command -v sudo >/dev/null || ! sudo -n true 2>/dev/null; then
          echo '媒体组件安装需要管理员权限；本次未启动服务。请完成宿主允许的系统认证后重新执行 install。已准备的 Node 会复用。' >&2
          exit 12
        fi
        elevate=(sudo -n)
      fi
      "${elevate[@]}" apt-get update -o APT::Update::Error-Mode=any -o Acquire::Retries=0 -o Acquire::http::Timeout=15 || install_failed '系统包索引更新失败'
      "${elevate[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-noto-cjk || install_failed '媒体组件系统包安装失败'
    fi
    node_ready && media_ready || install_failed '安装后组件检查未通过'
    echo '组件安装完成；请另行经宿主执行审批启动，并在独立调用中查询状态。'
    ;;
  check)
    (( $# == 0 )) || exit 2
    node_ready && media_ready || missing
    "$node_bin" --version
    ffmpeg -version
    ffprobe -version
    ;;
  start)
    node_ready && media_ready || missing
    exec "$node_bin" "$plugin_dir/dist/runtime.js" start "$@"
    ;;
  status|stop)
    node_ready || missing
    exec "$node_bin" "$plugin_dir/dist/runtime.js" "$action" "$@"
    ;;
  mcp)
    node_ready || missing
    exec "$node_bin" "$plugin_dir/dist/mcp/main.js" "$@"
    ;;
  *) echo '用法：runtime-linux.sh check|install|start|status|stop|mcp；start/status/stop 沿用 --project 与 --port。' >&2; exit 2 ;;
esac
