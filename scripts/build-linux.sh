#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

china_mirror=0
skip_setup=0
skip_dependencies=0
run_tests=0
run_e2e=0
setup_only=0
target=all

usage() {
  cat <<'EOF'
Usage: scripts/build-linux.sh [options]

Build and verify the Linux AppImage and deb packages on a native Linux host.

Options:
  --china-mirror       Use process-local npm, Electron, and Rust mirrors.
  --skip-setup         Do not install missing system prerequisites.
  --skip-dependencies  Reuse the existing node_modules directory.
  --run-tests          Run the full Vitest suite before packaging.
  --run-e2e            Run Electron E2E before packaging.
  --setup-only         Install/check prerequisites, then stop.
  --appimage-only      Build and verify only the AppImage.
  --deb-only           Build and verify only the Debian package.
  -h, --help           Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --china-mirror) china_mirror=1 ;;
    --skip-setup) skip_setup=1 ;;
    --skip-dependencies) skip_dependencies=1 ;;
    --run-tests) run_tests=1 ;;
    --run-e2e) run_e2e=1 ;;
    --setup-only) setup_only=1 ;;
    --appimage-only)
      [[ "${target}" == all ]] || { echo "[aiopsterm] choose only one package target" >&2; exit 2; }
      target=appimage
      ;;
    --deb-only)
      [[ "${target}" == all ]] || { echo "[aiopsterm] choose only one package target" >&2; exit 2; }
      target=deb
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[aiopsterm] unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "${OSTYPE:-}" != linux* ]] || [[ "$(uname -s)" != Linux ]]; then
  echo '[aiopsterm] scripts/build-linux.sh can only run on Linux.' >&2
  exit 1
fi

run_privileged() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo '[aiopsterm] sudo is required to install missing Linux prerequisites.' >&2
    return 1
  fi
}

command_missing() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1
}

node_is_supported() {
  command_missing node || return 1
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1
}

configure_sources() {
  if ((china_mirror)); then
    export npm_config_registry='https://registry.npmmirror.com/'
    export npm_config_disturl='https://npmmirror.com/mirrors/node'
    export ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
    export ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
    export npm_config_electron_mirror="${ELECTRON_MIRROR}"
    export npm_config_electron_builder_binaries_mirror="${ELECTRON_BUILDER_BINARIES_MIRROR}"
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://npmmirror.com/mirrors/electron/'
    export RUSTUP_DIST_SERVER='https://rsproxy.cn'
    export RUSTUP_UPDATE_ROOT='https://rsproxy.cn/rustup'
  else
    export npm_config_registry='https://registry.npmjs.org/'
    export npm_config_disturl='https://nodejs.org/dist'
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://artifacts.electronjs.org/headers/dist'
  fi
}

install_system_packages() {
  local manager
  local -a packages
  if command -v apt-get >/dev/null 2>&1; then
    manager=apt
    packages=(ca-certificates curl git python3 pkg-config musl-tools libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils dpkg-dev fakeroot xvfb)
  elif command -v dnf >/dev/null 2>&1; then
    manager=dnf
    packages=(ca-certificates curl git python3 pkgconf-pkg-config musl-gcc libcap-devel gcc-c++ clang libcxx-devel libcxxabi-devel lld xz dpkg fakeroot xorg-x11-server-Xvfb)
  elif command -v yum >/dev/null 2>&1; then
    manager=yum
    packages=(ca-certificates curl git python3 pkgconfig musl-gcc libcap-devel gcc-c++ clang libcxx-devel libcxxabi-devel lld xz dpkg fakeroot xorg-x11-server-Xvfb)
  elif command -v pacman >/dev/null 2>&1; then
    manager=pacman
    packages=(ca-certificates curl git python pkgconf musl gcc clang lld xz dpkg fakeroot xorg-server-xvfb)
  else
    echo '[aiopsterm] unsupported Linux package manager; install the documented prerequisites manually.' >&2
    return 1
  fi

  echo "[aiopsterm] installing missing Linux prerequisites with ${manager}"
  case "${manager}" in
    apt)
      run_privileged apt-get update
      run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
      ;;
    dnf) run_privileged dnf install -y "${packages[@]}" ;;
    yum) run_privileged yum install -y "${packages[@]}" ;;
    pacman) run_privileged pacman -Sy --needed --noconfirm "${packages[@]}" ;;
  esac
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "${NVM_DIR}/nvm.sh"
  fi
}

ensure_node() {
  load_nvm
  if node_is_supported && command_missing npm; then
    return
  fi
  if ! command_missing nvm; then
    echo '[aiopsterm] installing nvm because Node.js 20+ is not available'
    curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    load_nvm
  fi
  command_missing nvm || { echo '[aiopsterm] nvm installation failed; install Node.js 22+ manually.' >&2; return 1; }
  local node_major="${AIOPSTERM_NODE_MAJOR:-22}"
  nvm install "${node_major}"
  nvm alias default "${node_major}"
  nvm use "${node_major}" >/dev/null
}

ensure_rustup() {
  if command_missing rustup; then
    echo '[aiopsterm] rustup is missing; installing it from the official rustup endpoint'
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    export PATH="${HOME}/.cargo/bin:${PATH}"
  fi
  command_missing rustup || { echo '[aiopsterm] rustup is still unavailable after installation.' >&2; return 1; }
}

ensure_prerequisites() {
  local -a system_required=(ca-certificates curl python3 git pkg-config musl-gcc clang ld.lld dpkg-deb xvfb-run)
  local missing=0 command_name
  for command_name in "${system_required[@]}"; do
    if ! command_missing "${command_name}"; then
      echo "[aiopsterm] missing command: ${command_name}" >&2
      missing=1
    fi
  done
  if ((missing)); then
    ((skip_setup)) && { echo '[aiopsterm] prerequisites are missing and --skip-setup was supplied.' >&2; return 1; }
    install_system_packages
  fi
  ensure_node
  ensure_rustup
  for command_name in node npm "${system_required[@]}"; do
    command_missing "${command_name}" || { echo "[aiopsterm] required command is still missing: ${command_name}" >&2; return 1; }
  done
  node_is_supported || { echo '[aiopsterm] Node.js 20 or newer is required for the Linux build.' >&2; return 1; }
}

run_npm() {
  echo "[aiopsterm] npm $*"
  npm "$@"
}

configure_sources
cd "${APP_ROOT}"
ensure_prerequisites
if ((setup_only)); then
  echo '[aiopsterm] Linux prerequisites are ready.'
  exit 0
fi
if ((!skip_dependencies)); then run_npm ci; fi
if ((run_tests)); then run_npm test; fi
if ((run_e2e)); then run_npm run test:e2e; fi

case "${target}" in
  all)
    run_npm run build:linux
    run_npm run package:verify -- linux-appimage
    run_npm run package:verify -- linux-deb
    ;;
  appimage)
    run_npm run build:linux:appimage
    run_npm run package:verify -- linux-appimage
    ;;
  deb)
    run_npm run build:deb
    run_npm run package:verify -- linux-deb
    ;;
esac

echo "[aiopsterm] Linux ${target} build and verification completed."
