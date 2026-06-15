#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

restart=0
skip_build=0
use_sandbox=0
extra_args=()

usage() {
  cat <<'EOF'
Usage: scripts/build-and-start.sh [options] [-- electron-vite-preview-args...]

Build aiopsterm and start the latest Electron preview.

Options:
  --restart     Stop existing aiopsterm preview processes before starting.
  --skip-build  Start the latest existing build without rebuilding.
  --sandbox     Start without passing electron-vite's --noSandbox flag.
  -h, --help    Show this help.

Examples:
  npm run build:start
  npm run build:start -- --restart
  scripts/build-and-start.sh --skip-build
EOF
}

while (($#)); do
  case "$1" in
    --restart)
      restart=1
      ;;
    --skip-build)
      skip_build=1
      ;;
    --sandbox)
      use_sandbox=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      extra_args+=("$@")
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

preview_pids() {
  ps -eo pid=,args= | awk -v root="${APP_ROOT}" '
    index($0, root "/node_modules/.bin/electron-vite") && index($0, " preview ") { print $1; next }
    index($0, root "/node_modules/electron/dist/electron") { print $1; next }
  '
}

cd "${APP_ROOT}"

if ((restart)); then
  mapfile -t pids < <(preview_pids)
  if ((${#pids[@]})); then
    echo "[aiopsterm] stopping existing preview processes: ${pids[*]}"
    kill "${pids[@]}" 2>/dev/null || true
    sleep 1
    mapfile -t remaining_pids < <(preview_pids)
    if ((${#remaining_pids[@]})); then
      echo "[aiopsterm] force stopping remaining preview processes: ${remaining_pids[*]}"
      kill -9 "${remaining_pids[@]}" 2>/dev/null || true
    fi
  else
    echo "[aiopsterm] no existing preview process found"
  fi
fi

if ((skip_build)); then
  echo "[aiopsterm] skipping build"
else
  echo "[aiopsterm] building"
  npm run build
fi

cmd=(npx electron-vite preview --skipBuild)
if ((!use_sandbox)); then
  cmd+=(--noSandbox)
fi
cmd+=("${extra_args[@]}")

echo "[aiopsterm] starting: ${cmd[*]}"
exec "${cmd[@]}"
