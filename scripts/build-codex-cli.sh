#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

target_triple="$(node --input-type=module -e "import { codexTargetTriple } from './scripts/codex-runtime-paths.mjs'; console.log(codexTargetTriple())")"
default_package_dir="$(node --input-type=module -e "import { codexPackageDir } from './scripts/codex-runtime-paths.mjs'; console.log(codexPackageDir())")"
package_dir="${AIOPSTERM_CODEX_PACKAGE_DIR:-${default_package_dir}}"
default_codex_bin="$(node --input-type=module -e "import { codexBinaryName } from './scripts/codex-runtime-paths.mjs'; console.log(codexBinaryName())")"
codex_bin="${AIOPSTERM_CODEX_BIN:-${package_dir}/bin/${default_codex_bin}}"

configure_musl_toolchain() {
  if [[ "${target_triple}" != *-unknown-linux-musl ]]; then
    return
  fi
  local cc_env_name="${target_triple//-/_}"
  cc_env_name="CC_${cc_env_name}"
  local musl_cc="${target_triple/-unknown/}-gcc"
  if [[ -n "${!cc_env_name:-}" ]]; then
    return
  fi
  if command -v "${musl_cc}" >/dev/null 2>&1; then
    export "${cc_env_name}=$(command -v "${musl_cc}")"
    return
  fi
  if command -v musl-gcc >/dev/null 2>&1; then
    export "${cc_env_name}=$(command -v musl-gcc)"
    return
  fi
  cat >&2 <<EOF
[aiopsterm] missing musl C compiler for ${target_triple}.
[aiopsterm] Install musl-tools, or set ${cc_env_name} to a compatible musl gcc wrapper.
[aiopsterm] Ubuntu/Debian: sudo apt-get install ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils
EOF
  exit 1
}

codex_builder_args=(
  --target "${target_triple}"
  --variant codex
  --cargo-profile release
  --package-dir "${package_dir}"
  --force
)
if [[ -n "${AIOPSTERM_CODEX_BWRAP_BIN:-}" ]]; then
  codex_builder_args+=(--bwrap-bin "${AIOPSTERM_CODEX_BWRAP_BIN}")
fi
if [[ -n "${AIOPSTERM_CODEX_RG_BIN:-}" ]]; then
  codex_builder_args+=(--rg-bin "${AIOPSTERM_CODEX_RG_BIN}")
fi

if [[ -n "${AIOPSTERM_CODEX_BIN:-}" ]]; then
  if [[ ! -x "${codex_bin}" ]]; then
    echo "[aiopsterm] AIOPSTERM_CODEX_BIN is not executable: ${codex_bin}" >&2
    exit 1
  fi
  echo "[aiopsterm] using Codex CLI binary from AIOPSTERM_CODEX_BIN: ${codex_bin}"
elif [[ -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex package exists: ${package_dir}"
elif [[ -d "${APP_ROOT}/codex/scripts/codex_package" && -d "${APP_ROOT}/codex/codex-rs" ]]; then
  echo "[aiopsterm] building Codex package for ${target_triple}"
  (cd "${APP_ROOT}/codex/codex-rs" && rustup target add "${target_triple}")
  configure_musl_toolchain
  python3 "${APP_ROOT}/codex/scripts/build_codex_package.py" "${codex_builder_args[@]}"
else
  echo "[aiopsterm] Codex source directory is missing: ${APP_ROOT}/codex" >&2
  echo "[aiopsterm] set AIOPSTERM_CODEX_PACKAGE_DIR/AIOPSTERM_CODEX_BIN or place Codex source at codex/." >&2
  exit 1
fi

if [[ ! -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex CLI binary is missing: ${codex_bin}" >&2
  exit 1
fi

node "${APP_ROOT}/scripts/audit-codex-runtime.mjs" "${codex_bin}"
