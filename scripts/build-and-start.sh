#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

restart=1
skip_build=0
skip_codex=0
use_sandbox=0
extra_args=()

desktop_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

ensure_desktop_hint() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return
  fi

  local desktop_dir desktop_file icon_path exec_path
  desktop_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
  desktop_file="${desktop_dir}/aiopsterm.desktop"
  icon_path="${APP_ROOT}/resources/icons/256x256.png"
  exec_path="${APP_ROOT}/scripts/build-and-start.sh"
  mkdir -p "${desktop_dir}"
  cat >"${desktop_file}" <<EOF
[Desktop Entry]
Name=aiopsterm
Exec="$(desktop_escape "${exec_path}")" --skip-build
Terminal=false
Type=Application
Icon=$(desktop_escape "${icon_path}")
StartupWMClass=aiopsterm
Comment=Self-owned AI operations terminal shell with backend-owned runtime boundaries.
Categories=Utility;
EOF
  export BAMF_DESKTOP_FILE_HINT="${desktop_file}"
}

usage() {
  cat <<'EOF'
Usage: scripts/build-and-start.sh [options] [-- electron-vite-preview-args...]

Build aiopsterm and start the latest Electron preview.

Options:
  --restart     Stop existing aiopsterm preview processes before starting (default).
  --no-restart  Do not stop an existing preview; report it and exit instead.
  --skip-build  Start the latest existing build without rebuilding.
  --skip-codex  Do not build the local Codex dev package.
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
    --no-restart)
      restart=0
      ;;
    --skip-build)
      skip_build=1
      ;;
    --skip-codex)
      skip_codex=1
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
  local pid args cwd
  while read -r pid args; do
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [[ "${cwd}" != "${APP_ROOT}"* && "${args}" != *"${APP_ROOT}"* && "${args}" != *"--app-path=${APP_ROOT}"* ]]; then
      continue
    fi
    if [[ "${args}" == *"electron-vite preview"* || "${args}" == *"${APP_ROOT}/node_modules/.bin/electron-vite"* || "${args}" == *"${APP_ROOT}/node_modules/electron/dist/electron"* ]]; then
      printf '%s\n' "${pid}"
    fi
  done < <(ps -eo pid=,args=)
}

cd "${APP_ROOT}"

codex_bin="$(
  node --input-type=module -e "
    import { join } from 'node:path';
    import { codexBinaryName, codexDevBuildBinaryPath } from './scripts/codex-runtime-paths.mjs';
    const packageDir = process.env.AIOPSTERM_CODEX_PACKAGE_DIR || process.env.AIOPSTERM_CODEX_DEV_PACKAGE_DIR;
    console.log(process.env.AIOPSTERM_CODEX_BIN || (packageDir ? join(packageDir, 'bin', codexBinaryName()) : codexDevBuildBinaryPath()));
  "
)"
codex_package_dir="$(
  node --input-type=module -e "
    import { dirname } from 'node:path';
    import { codexDevBuildBinaryPath } from './scripts/codex-runtime-paths.mjs';
    console.log(process.env.AIOPSTERM_CODEX_PACKAGE_DIR || process.env.AIOPSTERM_CODEX_DEV_PACKAGE_DIR || dirname(dirname(process.env.AIOPSTERM_CODEX_BIN || codexDevBuildBinaryPath())));
  "
)"
if ((skip_codex)); then
  echo "[aiopsterm] skipping Codex dev package build"
else
  bash "${APP_ROOT}/scripts/build-codex-dev-package.sh"
fi

if [[ ! -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex CLI binary is missing: ${codex_bin}" >&2
  echo "[aiopsterm] rerun without --skip-codex or set AIOPSTERM_CODEX_PACKAGE_DIR/AIOPSTERM_CODEX_BIN to a valid Codex runtime." >&2
  exit 1
fi
export AIOPSTERM_CODEX_PACKAGE_DIR="${codex_package_dir}"
: "${AIOPSTERM_CRASH_DIAGNOSTICS:=1}"
export AIOPSTERM_CRASH_DIAGNOSTICS
ensure_desktop_hint
user_data_dir="${AIOPSTERM_USER_DATA_DIR:-${HOME}/.config/aiopsterm}"
log_dir="${user_data_dir}/logs"
preview_log="${log_dir}/electron-preview.log"
mkdir -p "${log_dir}"

mapfile -t pids < <(preview_pids)
if ((${#pids[@]})); then
  if ((restart)); then
    echo "[aiopsterm] stopping existing preview processes: ${pids[*]}"
    diagnostic_dir="${user_data_dir}/crash-diagnostics"
    mkdir -p "${diagnostic_dir}"
    pids_csv="$(IFS=,; printf '%s' "${pids[*]}")"
    printf '{"createdAt":"%s","pids":[%s]}\n' "$(date -Is)" "${pids_csv}" >"${diagnostic_dir}/expected-restart.json"
    kill "${pids[@]}" 2>/dev/null || true
    sleep 1
    mapfile -t remaining_pids < <(preview_pids)
    if ((${#remaining_pids[@]})); then
      echo "[aiopsterm] force stopping remaining preview processes: ${remaining_pids[*]}"
      kill -9 "${remaining_pids[@]}" 2>/dev/null || true
    fi
  else
    echo "[aiopsterm] preview is already running: ${pids[*]}"
    echo "[aiopsterm] exiting without starting a second Electron instance; rerun without --no-restart to replace it."
    exit 0
  fi
else
  echo "[aiopsterm] no existing preview process found"
fi

if ((skip_build)); then
  echo "[aiopsterm] skipping build"
else
  echo "[aiopsterm] building"
  npm run build
fi

npm run native:ensure:electron

cmd=(npx electron-vite preview --skipBuild)
if ((!use_sandbox)); then
  cmd+=(--noSandbox)
fi
cmd+=("${extra_args[@]}")

echo "[aiopsterm] starting: ${cmd[*]}"
{
  printf '\n[%s] starting: %s\n' "$(date -Is)" "${cmd[*]}"
} >>"${preview_log}"
"${cmd[@]}" > >(tee -a "${preview_log}") 2> >(tee -a "${preview_log}" >&2) &
preview_pid=$!

cleanup_preview() {
  if kill -0 "${preview_pid}" 2>/dev/null; then
    kill "${preview_pid}" 2>/dev/null || true
  fi
}
trap cleanup_preview INT TERM

sleep 3
if ! kill -0 "${preview_pid}" 2>/dev/null; then
  set +e
  wait "${preview_pid}"
  status=$?
  set -e
  echo "[aiopsterm] preview exited during startup with status ${status}."
  runtime_log="${user_data_dir}/logs/aiopsterm-runtime.log"
  if [[ -f "${runtime_log}" ]]; then
    echo "[aiopsterm] recent runtime log: ${runtime_log}"
    tail -80 "${runtime_log}" || true
  fi
  exit "${status}"
fi

echo "[aiopsterm] preview started with pid ${preview_pid}"
wait "${preview_pid}"
