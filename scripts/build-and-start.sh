#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

restart=1
skip_build=0
skip_codex=0
use_sandbox=0
extra_args=()

usage() {
  cat <<'EOF'
Usage: scripts/build-and-start.sh [options] [-- electron-vite-preview-args...]

Build aiopsterm and start the latest Electron preview.

Options:
  --restart     Stop existing aiopsterm preview processes before starting (default).
  --no-restart  Do not stop an existing preview; report it and exit instead.
  --skip-build  Start the latest existing build without rebuilding.
  --skip-codex  Do not build the bundled Codex CLI binary.
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

codex_bin="${AIOPSTERM_CODEX_BIN:-${APP_ROOT}/codex/codex-rs/target/release/codex}"
if [[ -n "${AIOPSTERM_CODEX_BIN:-}" ]]; then
  if [[ ! -x "${codex_bin}" ]]; then
    echo "[aiopsterm] AIOPSTERM_CODEX_BIN is not executable: ${codex_bin}" >&2
    exit 1
  fi
  echo "[aiopsterm] using Codex CLI binary from AIOPSTERM_CODEX_BIN: ${codex_bin}"
elif ((skip_codex)); then
  echo "[aiopsterm] skipping Codex CLI build"
elif [[ -d "${APP_ROOT}/codex/codex-rs" ]]; then
  if [[ -x "${codex_bin}" ]]; then
    echo "[aiopsterm] Codex CLI binary exists: ${codex_bin}"
  else
    echo "[aiopsterm] building Codex CLI binary"
    (cd "${APP_ROOT}/codex/codex-rs" && cargo build --release -p codex-cli)
  fi
else
  echo "[aiopsterm] Codex source directory is missing: ${APP_ROOT}/codex/codex-rs" >&2
  exit 1
fi

if [[ ! -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex CLI binary is missing: ${codex_bin}" >&2
  echo "[aiopsterm] rerun without --skip-codex or set AIOPSTERM_CODEX_BIN to a valid Codex binary." >&2
  exit 1
fi

mapfile -t pids < <(preview_pids)
if ((${#pids[@]})); then
  if ((restart)); then
    echo "[aiopsterm] stopping existing preview processes: ${pids[*]}"
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

cmd=(npx electron-vite preview --skipBuild)
if ((!use_sandbox)); then
  cmd+=(--noSandbox)
fi
cmd+=("${extra_args[@]}")

echo "[aiopsterm] starting: ${cmd[*]}"
"${cmd[@]}" &
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
  runtime_log="${HOME}/.config/aiopsterm/logs/aiopsterm-runtime.log"
  if [[ -f "${runtime_log}" ]]; then
    echo "[aiopsterm] recent runtime log: ${runtime_log}"
    tail -80 "${runtime_log}" || true
  fi
  exit "${status}"
fi

echo "[aiopsterm] preview started with pid ${preview_pid}"
wait "${preview_pid}"
