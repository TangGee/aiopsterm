#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

china_mirror=0
npm_registry=''
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
  --china-mirror       Use process-local Node, npm, Electron, Rust, Cargo, and GitHub mirrors.
  --npm-registry URL   Override the process-local npm registry.
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
    --npm-registry)
      if (($# < 2)) || [[ "$2" == --* ]]; then
        echo '[aiopsterm] --npm-registry requires a URL.' >&2
        exit 2
      fi
      npm_registry="$2"
      shift
      ;;
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

command_exists() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1
}

node_is_supported() {
  command_exists node || return 1
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1
}

configure_sources() {
  if ((china_mirror)); then
    export npm_config_registry='https://registry.npmmirror.com/'
    export npm_config_disturl='https://npmmirror.com/mirrors/node'
    export NVM_NODEJS_ORG_MIRROR='https://npmmirror.com/mirrors/node'
    export NVM_SOURCE='https://gitee.com/mirrors/nvm.git'
    export AIOPSTERM_NVM_INSTALL_URL='https://gitee.com/mirrors/nvm/raw/v0.40.3/install.sh'
    export ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
    export ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
    export npm_config_electron_mirror="${ELECTRON_MIRROR}"
    export npm_config_electron_builder_binaries_mirror="${ELECTRON_BUILDER_BINARIES_MIRROR}"
    # npmmirror mirrors Electron binaries but not the node-v*-headers archives
    # consumed by node-gyp. Keep the dedicated headers endpoint on Electron's CDN.
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://artifacts.electronjs.org/headers/dist'
    export RUSTUP_DIST_SERVER='https://rsproxy.cn'
    export RUSTUP_UPDATE_ROOT='https://rsproxy.cn/rustup'
    export AIOPSTERM_RUSTUP_INSTALL_URL='https://rsproxy.cn/rustup-init.sh'
    export AIOPSTERM_GITHUB_MIRROR="${AIOPSTERM_GITHUB_MIRROR:-https://ghproxy.net/https://github.com/}"
    export CARGO_REGISTRIES_CRATES_IO_INDEX='sparse+https://rsproxy.cn/index/'
    export CARGO_REGISTRIES_CRATES_IO_PROTOCOL='sparse'
    export CARGO_NET_GIT_FETCH_WITH_CLI='true'
  else
    export npm_config_registry='https://registry.npmjs.org/'
    export npm_config_disturl='https://nodejs.org/dist'
    export AIOPSTERM_NVM_INSTALL_URL='https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh'
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://artifacts.electronjs.org/headers/dist'
    export AIOPSTERM_RUSTUP_INSTALL_URL='https://sh.rustup.rs'
  fi
  if [[ -n "${npm_registry}" ]]; then
    export npm_config_registry="${npm_registry}"
  fi
}

configure_git_mirror() {
  ((china_mirror)) || return 0
  export AIOPSTERM_REAL_GIT
  AIOPSTERM_REAL_GIT="$(command -v git)"
  export PATH="${APP_ROOT}/scripts/china-mirror-bin:${PATH}"
}

configure_build_resources() {
  [[ -z "${CARGO_BUILD_JOBS:-}" ]] || return 0
  [[ -r /proc/meminfo ]] || return 0

  local mem_total_kib
  mem_total_kib="$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo)"
  if [[ "${mem_total_kib}" =~ ^[0-9]+$ ]] && ((mem_total_kib < 12 * 1024 * 1024)); then
    export CARGO_BUILD_JOBS=2
    echo '[aiopsterm] low-memory host detected; limiting Cargo to 2 parallel jobs'
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
  if node_is_supported && command_exists npm; then
    return
  fi
  if ! command_exists nvm; then
    echo '[aiopsterm] installing nvm because Node.js 20+ is not available'
    curl --proto '=https' --tlsv1.2 -sSfL "${AIOPSTERM_NVM_INSTALL_URL}" | bash
    load_nvm
  fi
  command_exists nvm || { echo '[aiopsterm] nvm installation failed; install Node.js 22+ manually.' >&2; return 1; }
  local node_major="${AIOPSTERM_NODE_MAJOR:-22}"
  nvm install "${node_major}"
  nvm alias default "${node_major}"
  nvm use "${node_major}" >/dev/null
}

ensure_rustup() {
  if ! command_exists rustup; then
    echo '[aiopsterm] rustup is missing; installing it from the configured rustup endpoint'
    curl --proto '=https' --tlsv1.2 -sSfL "${AIOPSTERM_RUSTUP_INSTALL_URL}" | sh -s -- -y --profile minimal
    export PATH="${HOME}/.cargo/bin:${PATH}"
  fi
  command_exists rustup || { echo '[aiopsterm] rustup is still unavailable after installation.' >&2; return 1; }
}

ensure_prerequisites() {
  local -a system_required=(curl python3 git pkg-config musl-gcc clang ld.lld dpkg-deb xvfb-run)
  local missing=0 command_name
  for command_name in "${system_required[@]}"; do
    if ! command_exists "${command_name}"; then
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
    command_exists "${command_name}" || { echo "[aiopsterm] required command is still missing: ${command_name}" >&2; return 1; }
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
configure_git_mirror
configure_build_resources
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
