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
codex_package_dir=''
release_mode=0
notary_profile="${AIOPSTERM_NOTARY_PROFILE:-aiopsterm-notary}"
release_signing=0
notarization_enabled=0

usage() {
  cat <<'EOF'
Usage: scripts/build-macos.sh [options]

Build and verify the macOS dmg and zip packages on a native macOS host.

Options:
  --china-mirror       Use process-local mainland China npm, Electron, Rust, Cargo, and Homebrew mirrors.
  --npm-registry URL   Override the process-local npm registry.
  --skip-setup         Do not install missing prerequisites.
  --skip-dependencies  Reuse the existing node_modules directory.
  --run-tests          Run the full Vitest suite before packaging.
  --run-e2e            Run Electron E2E before packaging.
  --setup-only         Install/check prerequisites, then stop.
  --codex-package-dir DIR
                       Reuse a complete current-architecture Codex package directory.
  --notary-profile NAME
                       Use a notarytool Keychain profile (default: aiopsterm-notary).
  --release            Build a Developer ID signed and notarized release package.
  --require-release-signing
                       Deprecated alias for --release.
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
    --codex-package-dir)
      if (($# < 2)) || [[ "$2" == --* ]]; then
        echo '[aiopsterm] --codex-package-dir requires a directory.' >&2
        exit 2
      fi
      codex_package_dir="$2"
      shift
      ;;
    --notary-profile)
      if (($# < 2)) || [[ "$2" == --* ]]; then
        echo '[aiopsterm] --notary-profile requires a profile name.' >&2
        exit 2
      fi
      notary_profile="$2"
      shift
      ;;
    --release|--require-release-signing) release_mode=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[aiopsterm] unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$(uname -s)" != Darwin ]]; then
  echo '[aiopsterm] scripts/build-macos.sh can only run on macOS.' >&2
  exit 1
fi

command_exists() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1
}

configure_xcode() {
  local full_xcode='/Applications/Xcode.app/Contents/Developer'
  if [[ -d "${full_xcode}" ]]; then
    export DEVELOPER_DIR="${DEVELOPER_DIR:-${full_xcode}}"
  fi
}

node_is_supported() {
  command_exists node || return 1
  node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 && major <= 24 && major % 2 === 0 ? 0 : 1)' >/dev/null 2>&1
}

configure_sources() {
  if ((china_mirror)); then
    export npm_config_registry='https://registry.npmmirror.com/'
    export npm_config_disturl='https://npmmirror.com/mirrors/node'
    export ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
    export ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
    export npm_config_electron_mirror="${ELECTRON_MIRROR}"
    export npm_config_electron_builder_binaries_mirror="${ELECTRON_BUILDER_BINARIES_MIRROR}"
    # npmmirror serves the header archive but its release checksum list omits that file.
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://artifacts.electronjs.org/headers/dist'
    export RUSTUP_DIST_SERVER='https://rsproxy.cn'
    export RUSTUP_UPDATE_ROOT='https://rsproxy.cn/rustup'
    export CARGO_REGISTRIES_CRATES_IO_PROTOCOL='sparse'
    export CARGO_REGISTRIES_CRATES_IO_INDEX='sparse+https://rsproxy.cn/index/'
    export HOMEBREW_API_DOMAIN='https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api'
    export HOMEBREW_BOTTLE_DOMAIN='https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles'
    export HOMEBREW_BREW_GIT_REMOTE='https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git'
    export HOMEBREW_CORE_GIT_REMOTE='https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git'
    export HOMEBREW_NO_AUTO_UPDATE=1
  else
    export npm_config_registry='https://registry.npmjs.org/'
    export npm_config_disturl='https://nodejs.org/dist'
    export AIOPSTERM_ELECTRON_HEADERS_URL='https://artifacts.electronjs.org/headers/dist'
    export CARGO_REGISTRIES_CRATES_IO_PROTOCOL='sparse'
    unset ELECTRON_MIRROR ELECTRON_BUILDER_BINARIES_MIRROR
    unset npm_config_electron_mirror npm_config_electron_builder_binaries_mirror
    unset RUSTUP_DIST_SERVER RUSTUP_UPDATE_ROOT CARGO_REGISTRIES_CRATES_IO_INDEX
    unset HOMEBREW_API_DOMAIN HOMEBREW_BOTTLE_DOMAIN HOMEBREW_BREW_GIT_REMOTE HOMEBREW_CORE_GIT_REMOTE HOMEBREW_NO_AUTO_UPDATE
  fi
  if [[ -n "${npm_registry}" ]]; then
    export npm_config_registry="${npm_registry}"
  fi
}

refresh_tool_paths() {
  local brew_prefix=''
  local supported_node_bin=''
  if node_is_supported; then
    supported_node_bin="$(dirname "$(command -v node)")"
  fi
  if command_exists brew; then
    brew_prefix="$(brew --prefix)"
    export PATH="${brew_prefix}/bin:${brew_prefix}/sbin:${PATH}"
  fi
  export PATH="${HOME}/.cargo/bin:${PATH}"
  if [[ -n "${supported_node_bin}" ]]; then
    export PATH="${supported_node_bin}:${PATH}"
  fi
  hash -r
}

ensure_command_line_tools() {
  if xcode-select -p >/dev/null 2>&1 && xcrun --find clang >/dev/null 2>&1; then
    return
  fi
  if ((skip_setup)); then
    echo '[aiopsterm] Xcode Command Line Tools are missing and --skip-setup was supplied.' >&2
    return 1
  fi
  echo '[aiopsterm] requesting Xcode Command Line Tools installation'
  xcode-select --install >/dev/null 2>&1 || true
  echo '[aiopsterm] finish the Xcode Command Line Tools installer, then rerun this script.' >&2
  return 1
}

ensure_homebrew() {
  if command_exists brew; then
    return
  fi
  echo '[aiopsterm] Homebrew is required to install missing macOS prerequisites.' >&2
  echo '[aiopsterm] install Homebrew from https://brew.sh, then rerun this script.' >&2
  return 1
}

brew_install() {
  local formula="$1"
  ensure_homebrew
  echo "[aiopsterm] installing ${formula} with Homebrew"
  brew install "${formula}"
  refresh_tool_paths
}

ensure_node() {
  if node_is_supported && command_exists npm; then
    return
  fi
  ((skip_setup)) && { echo '[aiopsterm] A supported Node.js LTS release (20, 22, or 24) and npm are required.' >&2; return 1; }
  local node_version="${AIOPSTERM_NODE_VERSION:-22.20.0}"
  local node_arch=''
  case "$(uname -m)" in
    arm64) node_arch=arm64 ;;
    x86_64) node_arch=x64 ;;
    *) echo "[aiopsterm] unsupported macOS architecture: $(uname -m)" >&2; return 1 ;;
  esac
  local archive_name="node-v${node_version}-darwin-${node_arch}.tar.gz"
  local node_cache_root="${AIOPSTERM_TOOLCHAIN_CACHE:-${HOME}/Library/Caches/aiopsterm/toolchains}"
  local install_dir="${node_cache_root}/node-v${node_version}-darwin-${node_arch}"
  if [[ ! -x "${install_dir}/bin/node" || ! -x "${install_dir}/bin/npm" ]]; then
    local download_base="https://nodejs.org/dist/v${node_version}"
    if ((china_mirror)); then
      download_base="https://npmmirror.com/mirrors/node/v${node_version}"
    fi
    local download_dir=''
    mkdir -p "${node_cache_root}"
    download_dir="$(mktemp -d "${node_cache_root}/node-download.XXXXXX")"
    echo "[aiopsterm] downloading Node.js ${node_version} from ${download_base}"
    curl --proto '=https' --tlsv1.2 -sSfL "${download_base}/${archive_name}" -o "${download_dir}/${archive_name}"
    curl --proto '=https' --tlsv1.2 -sSfL "${download_base}/SHASUMS256.txt" -o "${download_dir}/SHASUMS256.txt"
    grep "  ${archive_name}$" "${download_dir}/SHASUMS256.txt" > "${download_dir}/SHASUMS256.selected"
    (cd "${download_dir}" && shasum -a 256 -c SHASUMS256.selected)
    tar -xzf "${download_dir}/${archive_name}" -C "${download_dir}"
    rm -rf -- "${install_dir}"
    mv "${download_dir}/node-v${node_version}-darwin-${node_arch}" "${install_dir}"
    rm -rf -- "${download_dir}"
  fi
  export PATH="${install_dir}/bin:${PATH}"
  hash -r
  node_is_supported && command_exists npm || { echo '[aiopsterm] A supported Node.js LTS release is still unavailable after installation.' >&2; return 1; }
}

ensure_python() {
  local python_candidate=''
  for python_candidate in /usr/bin/python3 "$(command -v python3 2>/dev/null || true)"; do
    if [[ -x "${python_candidate}" ]] && "${python_candidate}" -c 'import distutils' >/dev/null 2>&1; then
      export PYTHON="${python_candidate}"
      export npm_config_python="${python_candidate}"
      echo "[aiopsterm] using node-gyp Python: $(${python_candidate} --version 2>&1) (${python_candidate})"
      return
    fi
  done
  ((skip_setup)) && { echo '[aiopsterm] Python 3 with distutils compatibility is required by node-gyp 9.' >&2; return 1; }
  brew_install python@3.11
  python_candidate="$(brew --prefix python@3.11)/bin/python3.11"
  [[ -x "${python_candidate}" ]] || { echo '[aiopsterm] A node-gyp-compatible Python is still unavailable after installation.' >&2; return 1; }
  export PYTHON="${python_candidate}"
  export npm_config_python="${python_candidate}"
}

ensure_rustup() {
  if command_exists rustup; then
    return
  fi
  ((skip_setup)) && { echo '[aiopsterm] rustup is required.' >&2; return 1; }
  local installer_url='https://sh.rustup.rs'
  if ((china_mirror)); then
    installer_url='https://rsproxy.cn/rustup-init.sh'
  fi
  echo "[aiopsterm] installing rustup from ${installer_url}"
  curl --proto '=https' --tlsv1.2 -sSf "${installer_url}" | sh -s -- -y --profile minimal --no-modify-path
  refresh_tool_paths
  command_exists rustup || { echo '[aiopsterm] rustup is still unavailable after installation.' >&2; return 1; }
}

ensure_prerequisites() {
  ensure_command_line_tools
  refresh_tool_paths
  local command_name
  for command_name in curl git make clang xcrun codesign hdiutil; do
    command_exists "${command_name}" || { echo "[aiopsterm] required macOS command is missing: ${command_name}" >&2; return 1; }
  done
  ensure_node
  ensure_python
  ensure_rustup
  node_is_supported || { echo '[aiopsterm] Node.js 20, 22, or 24 is required for the macOS build.' >&2; return 1; }
}

configure_release_signing() {
  local identities=''
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  if grep -q '"Developer ID Application:' <<<"${identities}"; then
    release_signing=1
    echo '[aiopsterm] Developer ID Application identity detected; release signing is enabled.'
  fi

  if [[ -n "${APPLE_API_KEY:-}" || -n "${APPLE_ID:-}" || -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
    notarization_enabled=1
  elif xcrun notarytool history --keychain-profile "${notary_profile}" --output-format json >/dev/null 2>&1; then
    export APPLE_KEYCHAIN_PROFILE="${notary_profile}"
    notarization_enabled=1
    echo "[aiopsterm] using notarytool Keychain profile: ${notary_profile}"
  fi

  if ((!release_signing || !notarization_enabled)); then
    echo '[aiopsterm] release packaging requires both a Developer ID Application identity and notarization credentials.' >&2
    echo "[aiopsterm] expected notarytool Keychain profile: ${notary_profile}" >&2
    return 1
  fi
}

configure_local_signing() {
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  export AIOPSTERM_MAC_FORCE_ADHOC_SIGN=1
  unset CSC_LINK CSC_KEY_PASSWORD CSC_NAME
  unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
  unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
  unset APPLE_KEYCHAIN APPLE_KEYCHAIN_PROFILE
  echo '[aiopsterm] local packaging mode: using ad-hoc signing and skipping Apple notarization.'
}

verify_release_signature() {
  ((release_signing)) || return 0
  local app_path=''
  app_path="$(find dist -maxdepth 2 -type d -name 'aiopsterm.app' -print -quit)"
  [[ -n "${app_path}" ]] || { echo '[aiopsterm] packaged aiopsterm.app was not found for signing verification.' >&2; return 1; }

  codesign --verify --deep --strict --verbose=2 "${app_path}"
  spctl --assess --type execute --verbose=4 "${app_path}"
  if ((notarization_enabled)); then
    xcrun stapler validate "${app_path}"
  fi
}

run_npm() {
  echo "[aiopsterm] npm $*"
  npm "$@"
}

prepare_build_electron_runtime() {
  local electron_root="${APP_ROOT}/node_modules/electron"
  local electron_app="${electron_root}/dist/Electron.app"
  local electron_executable="${electron_app}/Contents/MacOS/Electron"
  local electron_installer="${electron_root}/install.js"

  if [[ ! -x "${electron_executable}" ]]; then
    [[ -f "${electron_installer}" ]] || {
      echo '[aiopsterm] Electron installer is missing; run without --skip-dependencies.' >&2
      return 1
    }
    echo '[aiopsterm] Electron runtime is incomplete; restoring the verified package binary.'
    node "${electron_installer}"
  fi
  [[ -x "${electron_executable}" ]] || {
    echo "[aiopsterm] Electron runtime executable is missing after installation: ${electron_executable}" >&2
    return 1
  }

  # Downloaded Electron.app is only a build tool here. Remove Gatekeeper quarantine
  # and apply a local signature before macOS launches it for native ABI probes.
  xattr -dr com.apple.quarantine "${electron_app}" 2>/dev/null || true
  codesign --force --deep --sign - "${electron_app}"
  codesign --verify --deep --strict "${electron_app}"
  ELECTRON_RUN_AS_NODE=1 "${electron_executable}" -e 'process.stdout.write(process.versions.electron || ""); process.exit(0)' >/dev/null
  echo '[aiopsterm] build Electron runtime passed local signature and launch verification.'
}

prepare_china_codex_assets() {
  ((china_mirror)) || return 0
  [[ -z "${AIOPSTERM_CODEX_PACKAGE_DIR:-}" ]] || return 0
  local rg_path=''
  local expected_arch=''
  rg_path="$(command -v rg 2>/dev/null || true)"
  case "$(uname -m)" in
    arm64) expected_arch=arm64 ;;
    x86_64) expected_arch=x86_64 ;;
  esac
  if [[ -n "${rg_path}" ]] && file "${rg_path}" | grep -q "${expected_arch}"; then
    export AIOPSTERM_CODEX_RG_BIN="${AIOPSTERM_CODEX_RG_BIN:-${rg_path}}"
    echo "[aiopsterm] using local ripgrep for Codex packaging: ${AIOPSTERM_CODEX_RG_BIN}"
  fi
  export AIOPSTERM_CODEX_DOWNLOAD_TIMEOUT_MS="${AIOPSTERM_CODEX_DOWNLOAD_TIMEOUT_MS:-120000}"
  echo '[aiopsterm] prefetching checksum-verified Codex V8 assets through configured GitHub mirrors'
  if ! node scripts/prepare-codex-dev-assets.mjs; then
    echo '[aiopsterm] Codex V8 mirror prefetch failed; continuing with the source builder download fallback.' >&2
  fi
}

configure_codex_package_override() {
  [[ -n "${codex_package_dir}" ]] || return 0
  local resolved_dir="${codex_package_dir}"
  if [[ "${resolved_dir}" != /* ]]; then
    resolved_dir="${APP_ROOT}/${resolved_dir}"
  fi
  if [[ ! -f "${resolved_dir}/codex-package.json" || ! -x "${resolved_dir}/bin/codex" ]]; then
    echo "[aiopsterm] incomplete Codex package directory: ${resolved_dir}" >&2
    return 1
  fi
  export AIOPSTERM_CODEX_PACKAGE_DIR="$(cd "${resolved_dir}" && pwd -P)"
  echo "[aiopsterm] reusing Codex package: ${AIOPSTERM_CODEX_PACKAGE_DIR}"
}

configure_xcode
configure_sources
refresh_tool_paths
cd "${APP_ROOT}"
ensure_prerequisites
if ((release_mode)); then
  configure_release_signing
else
  configure_local_signing
fi
if ((setup_only)); then
  echo '[aiopsterm] macOS prerequisites are ready.'
  exit 0
fi
if ((!skip_dependencies)); then run_npm ci; fi
prepare_build_electron_runtime
if ((run_tests)); then run_npm test; fi
if ((run_e2e)); then run_npm run test:e2e; fi
configure_codex_package_override
prepare_china_codex_assets

run_npm run package:build -- macos
run_npm run package:verify -- macos
verify_release_signature

echo '[aiopsterm] macOS dmg and zip build and verification completed.'
