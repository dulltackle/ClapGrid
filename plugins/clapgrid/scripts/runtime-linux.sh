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
    ' >/dev/null 2>&1; then
      node_bin=$candidate
      [[ $candidate != "$runtime_home/node/bin/node" ]] || export PATH="$runtime_home/node/bin:$PATH"
      return 0
    fi
  done
  return 1
}

ffmpeg_ready() {
  local encoders filters encoder
  encoders=$("$1" -hide_banner -encoders 2>/dev/null) || return 1
  for encoder in libx264 mpeg4 libvpx libvorbis ffv1 aac; do
    [[ $encoders =~ [[:space:]]$encoder[[:space:]] ]] || return 1
  done
  filters=$("$1" -hide_banner -h filter=subtitles 2>/dev/null) || return 1
  [[ $filters == *wrap_unicode* ]]
}

fonts_ready() {
  local fonts
  fonts=$(fc-list :lang=zh family 2>/dev/null) && [[ -n $fonts ]]
}

# 每个组件独立选择，兼容的系统组件优先；子进程继承相同 PATH 和字体配置。
system_path=$PATH
configure_environment() {
  PATH=$system_path
  if ! ffmpeg_ready ffmpeg && ffmpeg_ready "$runtime_home/media/ffmpeg/ffmpeg"; then
    PATH="$runtime_home/media/ffmpeg:$PATH"
  fi
  if ! ffprobe -version >/dev/null 2>&1 && "$runtime_home/media/ffprobe/ffprobe" -version >/dev/null 2>&1; then
    PATH="$runtime_home/media/ffprobe:$PATH"
  fi
  if [[ -f $runtime_home/fonts.conf ]]; then
    export FONTCONFIG_FILE="$runtime_home/fonts.conf"
  fi
  export PATH
}
configure_environment

media_ready() {
  fonts_ready && ffprobe -version >/dev/null 2>&1 && ffmpeg_ready ffmpeg
}

# 下载和试运行只发生在锁内的临时目录；每个组件通过后独立发布，重试可复用。
download() {
  local name=$1 url=$2 digest=$3
  curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 \
    "$url" -o "$temporary/$name" || install_failed "$name 下载失败"
  (cd -- "$temporary" && printf '%s  %s\n' "$digest" "$name" | sha256sum -c -) || install_failed "$name SHA-256 摘要校验失败"
}

publish() {
  local candidate=$1 destination=$2 backup=""
  if [[ -e $destination || -L $destination ]]; then
    backup="$destination.invalid.$$.${RANDOM}"
    mv -- "$destination" "$backup" || install_failed '无法保留旧组件'
  fi
  if ! mv -- "$candidate" "$destination"; then
    [[ -z $backup ]] || mv -- "$backup" "$destination" || install_failed "无法发布组件且恢复失败，旧组件位于 $backup"
    install_failed '无法发布组件'
  fi
}

xml_text() {
  local value=$1
  value=${value//&/\&amp;}; value=${value//</\&lt;}; value=${value//>/\&gt;}
  printf '%s' "$value"
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
    case "$(uname -m)" in
      x86_64) arch=x64; media_arch=linux64; digest=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
        media_digest=35168ba5f8edfa264eb2e2e3071d1b9d67d88ae667b665b284cb4be7f68ab23c ;;
      aarch64) arch=arm64; media_arch=linuxarm64; digest=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b
        media_digest=b02041f1ea83482f34b3bc3703eaa62f012374a98c63887c4133c7a8af0b3a43 ;;
      *) echo '自动安装仅支持 glibc x86_64/aarch64 Linux；请自行提供兼容组件后执行 check。' >&2; exit 11 ;;
    esac
    libc=$(getconf GNU_LIBC_VERSION 2>/dev/null || true)
    [[ $libc == glibc\ * ]] || {
      echo '自动安装仅支持 glibc Linux，不支持 musl 或无法识别的 libc；请自行提供兼容组件后执行 check。' >&2; exit 11;
    }
    for tool in curl tar xz sha256sum mktemp mkdir mv rm flock fc-list cat; do
      command -v "$tool" >/dev/null || install_failed "缺少基础工具 $tool，请先准备该工具"
    done
    mkdir -p -- "$runtime_home" || install_failed '无法创建组件目录'
    exec 9>"$runtime_home/install.lock" || install_failed '无法打开安装锁'
    flock -n 9 || install_failed '另一个组件安装正在进行，请等待其完成'
    temporary=$(mktemp -d "$runtime_home/.install-XXXXXXXX") || install_failed '无法创建下载目录'
    trap 'rm -rf -- "$temporary"' EXIT
    if ! node_ready; then
      archive="node-v22.23.4-linux-$arch.tar.xz"
      download "$archive" "https://nodejs.org/dist/v22.23.4/$archive" "$digest"
      tar -xJf "$temporary/$archive" -C "$temporary" || install_failed 'Node 解压失败'
      "$temporary/node-v22.23.4-linux-$arch/bin/node" --input-type=module -e 'await import("node:sqlite")' >/dev/null 2>&1 || install_failed '下载的 Node 无法运行'
      publish "$temporary/node-v22.23.4-linux-$arch" "$runtime_home/node"
    fi
    if ! ffmpeg_ready ffmpeg || ! ffprobe -version >/dev/null 2>&1; then
      # BtbN 仅限期保留构建；ClapGrid Release 同时保留原包、对应源码及构建脚本。
      archive="ffmpeg-n8.1.3-20-gc8de997cb1-$media_arch-gpl-8.1.tar.xz"
      download "$archive" "https://github.com/dulltackle/ClapGrid/releases/download/linux-components-2026-10-21/$archive" "$media_digest"
      tar -xJf "$temporary/$archive" -C "$temporary" || install_failed 'FFmpeg 解压失败'
      extracted="$temporary/${archive%.tar.xz}"
      ffmpeg_ready "$extracted/bin/ffmpeg" && "$extracted/bin/ffprobe" -version >/dev/null 2>&1 || install_failed '下载的 FFmpeg/ffprobe 无法运行或能力不足'
      mkdir -p -- "$runtime_home/media" || install_failed '无法创建媒体组件目录'
      for tool in ffmpeg ffprobe; do
        if { [[ $tool == ffmpeg ]] && ! ffmpeg_ready ffmpeg; } || { [[ $tool == ffprobe ]] && ! ffprobe -version >/dev/null 2>&1; }; then
          mkdir -p -- "$temporary/$tool" || install_failed '无法准备媒体组件'
          mv -- "$extracted/bin/$tool" "$temporary/$tool/$tool" || install_failed '无法准备媒体程序'
          publish "$temporary/$tool" "$runtime_home/media/$tool"
        fi
      done
      configure_environment
    fi
    if ! fonts_ready; then
      # Sans2.004 Release 对应的单个字重，避免下载全部字重的 ZIP。
      download NotoSansCJKsc-Regular.otf \
        'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf' \
        2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b
      mkdir -p -- "$temporary/fonts" || install_failed '无法准备字体目录'
      mv -- "$temporary/NotoSansCJKsc-Regular.otf" "$temporary/fonts/" || install_failed '无法准备字体'
      [[ -r $plugin_dir/licenses/NotoSansCJK-OFL.txt ]] || install_failed '插件缺少字体许可文件'
      printf '%s\n' "$(< "$plugin_dir/licenses/NotoSansCJK-OFL.txt")" > "$temporary/fonts/OFL.txt" || install_failed '无法保存字体许可'
      system_fonts=${FONTCONFIG_FILE:-/etc/fonts/fonts.conf}
      # 旧插件配置不能递归包含自身。
      [[ $system_fonts != "$runtime_home/fonts.conf" ]] || system_fonts=/etc/fonts/fonts.conf
      cat > "$temporary/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">$(xml_text "$system_fonts")</include>
  <dir>$(xml_text "$temporary/fonts")</dir>
  <cachedir>$(xml_text "$runtime_home/font-cache")</cachedir>
</fontconfig>
EOF
      FONTCONFIG_FILE="$temporary/fonts.conf" fonts_ready || install_failed '下载的中文字体无法枚举'
      publish "$temporary/fonts" "$runtime_home/fonts"
      # 用最终目录生成配置，原子替换，运行环境只在发布完成后切换。
      config=$(< "$temporary/fonts.conf")
      config=${config//"$(xml_text "$temporary/fonts")"/"$(xml_text "$runtime_home/fonts")"}
      printf '%s\n' "$config" > "$temporary/fonts.conf" || install_failed '无法生成字体配置'
      publish "$temporary/fonts.conf" "$runtime_home/fonts.conf"
      configure_environment
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
  start|open)
    node_ready && media_ready || missing
    exec "$node_bin" "$plugin_dir/dist/runtime.js" "$action" "$@"
    ;;
  status|stop|workspace-status|workspace-stop|import-project)
    node_ready || missing
    exec "$node_bin" "$plugin_dir/dist/runtime.js" "$action" "$@"
    ;;
  mcp)
    node_ready || missing
    exec "$node_bin" "$plugin_dir/dist/mcp/main.js" "$@"
    ;;
  *) echo '用法：runtime-linux.sh check|install|start|status|stop|mcp；start/status/stop 沿用 --project 与 --port。' >&2; exit 2 ;;
esac
