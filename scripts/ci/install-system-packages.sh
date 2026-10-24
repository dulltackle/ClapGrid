#!/usr/bin/env bash
# 下载阶段可恢复一次；安装阶段禁止再次下载，也不重试。
set -euo pipefail
export LC_ALL=C
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mirrorlist=${CLAPGRID_APT_MIRRORLIST:-/etc/apt/apt-mirrors.txt}
primary_seconds=${CLAPGRID_APT_PRIMARY_SECONDS:-90}
fallback_seconds=${CLAPGRID_APT_FALLBACK_SECONDS:-150}
cache_dir=${CLAPGRID_APT_CACHE_DIR:-$PWD/.cache/system-packages}
log_file=${CLAPGRID_APT_LOG:-$PWD/logs/system-dependencies.log}
download_only=false
if [[ ${1:-} == --download-only ]]; then download_only=true; shift; fi
if [[ $# == 0 ]]; then echo '用法：install-system-packages.sh [--download-only] <包...>' >&2; exit 2; fi
mkdir -p -- "$(dirname -- "$log_file")" "$cache_dir"
cache_dir=$(cd -- "$cache_dir" && pwd)
exec 3>&1
exec > >(tee -a "$log_file") 2>&1
logger_pid=$!
attempts=0
result=failed
finish() {
  status=$?
  trap - EXIT
  printf 'finished=%s result=%s attempts=%s exit=%s cache-hit=%s\n' "$(date -u +%FT%TZ)" "$result" "$attempts" "$status" "${CLAPGRID_APT_CACHE_HIT:-unknown}"
  # 关闭管道写端后等待读取器，日志写入失败同样使依赖步骤失败。
  exec >&3 2>&1
  exec 3>&-
  if ! wait "$logger_pid"; then
    echo '依赖日志写入失败' >&2
    result=failed
    status=1
  fi
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '系统依赖：%s；尝试 %s 次；缓存命中 %s。\n' "$result" "$attempts" "${CLAPGRID_APT_CACHE_HIT:-unknown}" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit "$status"
}
trap finish EXIT
printf 'started=%s cache-hit=%s mode=%s\n' "$(date -u +%FT%TZ)" "${CLAPGRID_APT_CACHE_HIT:-unknown}" "$download_only"
for seconds in "$primary_seconds" "$fallback_seconds"; do
  [[ $seconds =~ ^[1-9][0-9]*$ ]] || { echo '下载时限必须是正整数秒'; exit 2; }
done
mapfile -t union < "$script_dir/system-packages.txt"
opts=(-o Acquire::http::Timeout=10 -o Acquire::https::Timeout=10 -o Acquire::Retries=0
  -o APT::Update::Error-Mode=any -o APT::Keep-Downloaded-Packages=true -o "Dir::Cache::archives=$cache_dir")
for budget in "$primary_seconds" "$fallback_seconds"; do
  attempts=$((attempts + 1))
  printf 'attempt=%s start=%s budget=%ss mirrors:\n' "$attempts" "$(date -u +%FT%TZ)" "$budget"
  cat -- "$mirrorlist"
  attempt_log=$(mktemp)
  status=0
  sudo timeout --signal=TERM --kill-after=5 "$budget" bash -c '
    count=$1; shift
    options=("${@:1:count}"); shift "$count"
    apt-get "${options[@]}" update &&
    apt-get "${options[@]}" install -y --no-install-recommends --download-only "$@"
  ' -- "${#opts[@]}" "${opts[@]}" "${union[@]}" > "$attempt_log" 2>&1 || status=$?
  cat -- "$attempt_log"
  reason=permanent-error
  # 完整性/签名错误优先于超时和任何同时出现的网络错误。
  if grep -Eiq 'NO_PUBKEY|EXPKEYSIG|BADSIG|NOSPLIT|NODATA|Clearsigned file|Signed file|signature|not signed|Hash Sum mismatch|Hashes of expected file|unexpected size|Unable to locate package|has no installation candidate' "$attempt_log"; then
    reason=integrity-or-package-error
  elif [[ $status == 124 || $status == 137 ]]; then
    reason=timeout
  elif grep -Eiq 'Could not resolve|Temporary failure resolving|Could not connect|Unable to connect|Connection (failed|timed out|refused)|Network is unreachable|No route to host|Failed to fetch.*(Timeout|timed out|Connection|resolve)|TLS connection was non-properly terminated|Could not handshake' "$attempt_log"; then
    reason=network-error
  fi
  rm -- "$attempt_log"
  printf 'attempt=%s end=%s exit=%s reason=%s\n' "$attempts" "$(date -u +%FT%TZ)" "$status" "$([[ $status == 0 ]] && echo success || echo "$reason")"
  if [[ $status == 0 ]]; then break; fi
  if [[ $attempts == 2 || ( $reason != timeout && $reason != network-error ) ]]; then exit "$status"; fi
  # 只调整已有 azure 条目的优先级；runner 使用显式 priority，单纯移动行无效。
  reordered=$(mktemp)
  awk '
    { lines[NR]=$0 }
    !/azure\.archive\.ubuntu\.com/ && match($0, /priority:[0-9]+/) {
      priority=substr($0, RSTART+9, RLENGTH-9)+0
      if (priority > maximum) maximum=priority
    }
    END {
      for (i=1;i<=NR;i++) if (lines[i] !~ /azure\.archive\.ubuntu\.com/) print lines[i]
      for (i=1;i<=NR;i++) if (lines[i] ~ /azure\.archive\.ubuntu\.com/) {
        if (lines[i] ~ /priority:[0-9]+/) sub(/priority:[0-9]+/, "priority:" maximum+1, lines[i])
        else lines[i]=lines[i] "\tpriority:" maximum+1
        print lines[i]
      }
    }
  ' "$mirrorlist" > "$reordered"
  sudo cp -- "$reordered" "$mirrorlist"
  rm -- "$reordered"
done
if [[ $download_only == false ]]; then
  echo "install start=$(date -u +%FT%TZ) packages=$*"
  sudo apt-get "${opts[@]}" install -y --no-install-recommends --no-download "$@"
  echo "install end=$(date -u +%FT%TZ)"
fi
result=passed
if [[ $attempts == 2 ]]; then result=recovered; fi
