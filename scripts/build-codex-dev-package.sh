#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

source "${APP_ROOT}/scripts/codex-rust-toolchain.sh"

cd "${APP_ROOT}"

target_triple="$(node --input-type=module -e "import { codexDevTargetTriple } from './scripts/codex-runtime-paths.mjs'; console.log(codexDevTargetTriple())")"
package_dir="${AIOPSTERM_CODEX_DEV_PACKAGE_DIR:-$(node --input-type=module -e "import { codexDevPackageDir } from './scripts/codex-runtime-paths.mjs'; console.log(codexDevPackageDir())")}"
binary_name="$(node --input-type=module -e "import { codexBinaryName } from './scripts/codex-runtime-paths.mjs'; console.log(codexBinaryName())")"
codex_bin="${package_dir}/bin/${binary_name}"

if [[ ! -d "${APP_ROOT}/codex/scripts/codex_package" || ! -d "${APP_ROOT}/codex/codex-rs" ]]; then
  echo "[aiopsterm] Codex source directory is missing: ${APP_ROOT}/codex" >&2
  exit 1
fi

prepend_pkg_config_path() {
  local path="$1"
  export PKG_CONFIG_PATH="${path}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"
}

openssl_pkg_config_version() {
  local pkgconfig_path="${1:-}"
  if [[ -n "${pkgconfig_path}" ]]; then
    PKG_CONFIG_PATH="${pkgconfig_path}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}" pkg-config --modversion openssl 2>/dev/null || true
  else
    pkg-config --modversion openssl 2>/dev/null || true
  fi
}

openssl_pkg_config_is_supported() {
  local version="$1"
  [[ "${version}" =~ ^[3-9][0-9]*\. ]]
}

openssl_pkg_config_libdir() {
  local pkgconfig_path="${1:-}"
  if [[ -n "${pkgconfig_path}" ]]; then
    PKG_CONFIG_PATH="${pkgconfig_path}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}" pkg-config --variable=libdir openssl 2>/dev/null || true
  else
    pkg-config --variable=libdir openssl 2>/dev/null || true
  fi
}

openssl_pkg_config_cflags() {
  local pkgconfig_path="${1:-}"
  if [[ -n "${pkgconfig_path}" ]]; then
    PKG_CONFIG_PATH="${pkgconfig_path}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}" pkg-config --cflags-only-I openssl 2>/dev/null || true
  else
    pkg-config --cflags-only-I openssl 2>/dev/null || true
  fi
}

openssl_local_header_shadow_is_unsupported() {
  local header="/usr/local/include/openssl/opensslv.h"
  if [[ ! -f "${header}" ]]; then
    return 1
  fi
  if grep -Eq 'OPENSSL_VERSION_MAJOR[[:space:]]+([3-9]|[1-9][0-9]+)\b|OPENSSL_VERSION_NUMBER[[:space:]]+0x[3-9]' "${header}"; then
    return 1
  fi
  return 0
}

openssl_pkg_config_has_non_system_include() {
  local pkgconfig_path="${1:-}"
  local cflags=""
  cflags="$(openssl_pkg_config_cflags "${pkgconfig_path}")"
  local flag include_dir real_include_dir
  for flag in ${cflags}; do
    include_dir="${flag#-I}"
    real_include_dir="$(readlink -f "${include_dir}" 2>/dev/null || true)"
    case "${real_include_dir}" in
      /usr/include|/usr/include/*|/lib/*|/usr/lib/*)
        ;;
      "")
        ;;
      *)
        return 0
        ;;
    esac
  done
  return 1
}

openssl_pkg_config_has_local_header_shadow_risk() {
  local pkgconfig_path="${1:-}"
  openssl_local_header_shadow_is_unsupported || return 1
  openssl_pkg_config_has_non_system_include "${pkgconfig_path}" && return 1
  return 0
}

try_prepend_supported_openssl_pkg_config_path() {
  local pkgconfig_path="$1"
  if [[ -z "${pkgconfig_path}" || ! -f "${pkgconfig_path}/openssl.pc" ]]; then
    return 1
  fi
  local version=""
  version="$(openssl_pkg_config_version "${pkgconfig_path}")"
  if ! openssl_pkg_config_is_supported "${version}"; then
    return 1
  fi
  if openssl_pkg_config_has_local_header_shadow_risk "${pkgconfig_path}"; then
    return 1
  fi
  prepend_pkg_config_path "${pkgconfig_path}"
  echo "[aiopsterm] using OpenSSL ${version} pkg-config from ${pkgconfig_path}"
}

configure_system_openssl_pkg_config() {
  local multiarch=""
  multiarch="$(gcc -print-multiarch 2>/dev/null || true)"
  local candidate
  for candidate in \
    "/usr/lib/${multiarch}/pkgconfig" \
    "/lib/${multiarch}/pkgconfig" \
    "/usr/lib/x86_64-linux-gnu/pkgconfig" \
    "/lib/x86_64-linux-gnu/pkgconfig" \
    "/usr/lib/aarch64-linux-gnu/pkgconfig" \
    "/lib/aarch64-linux-gnu/pkgconfig" \
    "/usr/lib/pkgconfig" \
    "/lib/pkgconfig"; do
    if try_prepend_supported_openssl_pkg_config_path "${candidate}"; then
      return
    fi
  done
  return 1
}

system_library_path() {
  local library="$1"
  local path=""
  if command -v ldconfig >/dev/null 2>&1; then
    path="$(ldconfig -p 2>/dev/null | awk -v library="${library}" '$1 == library { print $NF; exit }')"
    if [[ -n "${path}" && -e "${path}" ]]; then
      printf '%s\n' "${path}"
      return
    fi
  fi

  local multiarch=""
  multiarch="$(gcc -print-multiarch 2>/dev/null || true)"
  local candidate
  for candidate in \
    "/usr/lib/${multiarch}/${library}" \
    "/lib/${multiarch}/${library}" \
    "/usr/lib/x86_64-linux-gnu/${library}" \
    "/lib/x86_64-linux-gnu/${library}" \
    "/usr/lib/aarch64-linux-gnu/${library}" \
    "/lib/aarch64-linux-gnu/${library}" \
    "/usr/lib/${library}" \
    "/lib/${library}"; do
    if [[ -n "${candidate}" && -e "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  return 1
}

link_system_openssl_runtime() {
  local openssl_lib_dir="$1"
  local library="$2"
  local system_path=""
  system_path="$(system_library_path "${library}")" || return 1
  ln -sfn "${system_path}" "${openssl_lib_dir}/${library}"
}

download_cached_libssl_dev() {
  local downloads_dir="$1"
  local deb=""
  mkdir -p "${downloads_dir}"
  deb="$(find "${downloads_dir}" -maxdepth 1 -type f -name 'libssl-dev_*.deb' | sort -V | tail -n 1 || true)"
  if [[ -z "${deb}" ]]; then
    echo "[aiopsterm] downloading libssl-dev from configured apt sources" >&2
    (
      cd "${downloads_dir}"
      apt-get download libssl-dev >&2
    ) || return 1
    deb="$(find "${downloads_dir}" -maxdepth 1 -type f -name 'libssl-dev_*.deb' | sort -V | tail -n 1 || true)"
  fi
  if [[ -z "${deb}" ]]; then
    return 1
  fi
  printf '%s\n' "${deb}"
}

prepare_cached_openssl_pkg_config() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 1
  fi
  if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
    return 1
  fi

  local cache_root="${AIOPSTERM_CODEX_DEV_CACHE_DIR:-${APP_ROOT}/.cache/aiopsterm-codex-dev}"
  local openssl_cache="${cache_root}/openssl-dev"
  local downloads_dir="${openssl_cache}/downloads"
  local extract_dir="${openssl_cache}/extract"
  local pkgconfig_dir="${openssl_cache}/pkgconfig"
  local deb=""

  if [[ ! -f "${pkgconfig_dir}/openssl.pc" ]]; then
    deb="$(download_cached_libssl_dev "${downloads_dir}")" || return 1
    rm -rf "${extract_dir}.tmp"
    mkdir -p "${extract_dir}.tmp"
    dpkg-deb -x "${deb}" "${extract_dir}.tmp" || return 1
    rm -rf "${extract_dir}"
    mv "${extract_dir}.tmp" "${extract_dir}"
  fi

  local openssl_pc=""
  openssl_pc="$(find "${extract_dir}/usr/lib" -path '*/pkgconfig/openssl.pc' -print -quit 2>/dev/null || true)"
  if [[ -z "${openssl_pc}" ]]; then
    return 1
  fi

  local source_pkgconfig_dir=""
  source_pkgconfig_dir="$(dirname "${openssl_pc}")"
  local libssl_link=""
  libssl_link="$(find "${extract_dir}/usr/lib" -name libssl.so -print -quit 2>/dev/null || true)"
  if [[ -z "${libssl_link}" ]]; then
    return 1
  fi

  local openssl_lib_dir=""
  openssl_lib_dir="$(dirname "${libssl_link}")"
  link_system_openssl_runtime "${openssl_lib_dir}" libssl.so.3 || return 1
  link_system_openssl_runtime "${openssl_lib_dir}" libcrypto.so.3 || return 1

  local openssl_arch_header=""
  openssl_arch_header="$(find "${extract_dir}/usr/include" -path '*/openssl/opensslconf.h' -print -quit 2>/dev/null || true)"
  if [[ -z "${openssl_arch_header}" ]]; then
    return 1
  fi
  local openssl_arch_include_dir=""
  openssl_arch_include_dir="$(dirname "$(dirname "${openssl_arch_header}")")"

  rm -rf "${pkgconfig_dir}"
  mkdir -p "${pkgconfig_dir}"
  local pc_name
  for pc_name in openssl.pc libssl.pc libcrypto.pc; do
    if [[ ! -f "${source_pkgconfig_dir}/${pc_name}" ]]; then
      return 1
    fi
    sed \
      -e "s#^prefix=.*#prefix=${extract_dir}/usr#" \
      -e "/^includedir=/a\\archincludedir=${openssl_arch_include_dir}" \
      -e 's#^Cflags: \(.*\)#Cflags: \1 -I${archincludedir}#' \
      "${source_pkgconfig_dir}/${pc_name}" > "${pkgconfig_dir}/${pc_name}"
  done

  local version=""
  version="$(openssl_pkg_config_version "${pkgconfig_dir}")"
  if openssl_pkg_config_is_supported "${version}" && PKG_CONFIG_PATH="${pkgconfig_dir}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}" pkg-config --exists openssl >/dev/null 2>&1; then
    prepend_pkg_config_path "${pkgconfig_dir}"
    echo "[aiopsterm] using locally cached OpenSSL ${version} dev package from ${openssl_cache}"
    return
  fi
  return 1
}

configure_openssl_pkg_config() {
  if ! command -v pkg-config >/dev/null 2>&1; then
    cat >&2 <<EOF
[aiopsterm] Codex dev build needs pkg-config and OpenSSL development files.
[aiopsterm] Ubuntu/Debian: sudo apt-get install pkg-config libssl-dev
EOF
    exit 1
  fi

  local version=""
  if [[ -n "${AIOPSTERM_OPENSSL_PKG_CONFIG_PATH:-}" ]] && try_prepend_supported_openssl_pkg_config_path "${AIOPSTERM_OPENSSL_PKG_CONFIG_PATH}"; then
    return
  fi

  version="$(openssl_pkg_config_version)"
  if pkg-config --exists openssl >/dev/null 2>&1 && openssl_pkg_config_is_supported "${version}" && ! openssl_pkg_config_has_local_header_shadow_risk; then
    echo "[aiopsterm] using OpenSSL ${version} pkg-config from $(openssl_pkg_config_libdir)"
    return
  fi
  if pkg-config --exists openssl >/dev/null 2>&1 && openssl_pkg_config_has_local_header_shadow_risk; then
    echo "[aiopsterm] ignoring OpenSSL ${version} pkg-config from $(openssl_pkg_config_libdir) because unsupported headers in /usr/local/include can shadow system headers" >&2
  elif [[ -n "${version}" ]]; then
    echo "[aiopsterm] ignoring unsupported default OpenSSL ${version} pkg-config from $(openssl_pkg_config_libdir)" >&2
  fi

  if prepare_cached_openssl_pkg_config; then
    return
  fi
  if configure_system_openssl_pkg_config; then
    return
  fi
  cat >&2 <<EOF
[aiopsterm] Codex dev build needs OpenSSL 3 development files.
[aiopsterm] Ubuntu/Debian: sudo apt-get install pkg-config libssl-dev
[aiopsterm] Without sudo, install pkg-config and let this script download libssl-dev from the configured apt mirror.
[aiopsterm] Or set PKG_CONFIG_PATH to a directory containing openssl.pc.
EOF
  exit 1
}

configure_openssl_pkg_config

aiopsterm_ensure_codex_rust_toolchain "${APP_ROOT}"
aiopsterm_install_codex_rust_target "${RUSTUP_TOOLCHAIN}" "${target_triple}"

cargo_profile="${AIOPSTERM_CODEX_DEV_CARGO_PROFILE:-dev-small}"
aiopsterm_clean_corrupt_codex_cargo_profile "${APP_ROOT}" "${target_triple}" "${cargo_profile}"
if [[ "${cargo_profile}" == "dev-small" ]]; then
  export CARGO_PROFILE_DEV_SMALL_DEBUG_ASSERTIONS="${CARGO_PROFILE_DEV_SMALL_DEBUG_ASSERTIONS:-false}"
fi

builder_args=(
  --target "${target_triple}"
  --variant codex
  --cargo "${AIOPSTERM_CODEX_CARGO_BIN}"
  --cargo-profile "${cargo_profile}"
  --package-dir "${package_dir}"
  --force
)

if [[ "${target_triple}" == *-unknown-linux-gnu ]]; then
  bwrap_bin="${AIOPSTERM_CODEX_BWRAP_BIN:-$(command -v bwrap || true)}"
  if [[ -n "${bwrap_bin}" ]]; then
    builder_args+=(--bwrap-bin "${bwrap_bin}")
  else
    echo "[aiopsterm] Linux Codex dev package needs bwrap. Install bubblewrap or set AIOPSTERM_CODEX_BWRAP_BIN." >&2
    exit 1
  fi
fi

if [[ -n "${AIOPSTERM_CODEX_RG_BIN:-}" ]]; then
  builder_args+=(--rg-bin "${AIOPSTERM_CODEX_RG_BIN}")
elif command -v rg >/dev/null 2>&1; then
  builder_args+=(--rg-bin "$(command -v rg)")
fi

echo "[aiopsterm] building local Codex dev package for ${target_triple}"
v8_env="$(node "${APP_ROOT}/scripts/prepare-codex-dev-assets.mjs")"
while IFS='=' read -r name value; do
  if [[ -n "${name}" && -n "${value}" ]]; then
    export "${name}=${value}"
  fi
done <<< "${v8_env}"

python3 "${APP_ROOT}/codex/scripts/build_codex_package.py" "${builder_args[@]}"

if [[ ! -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex dev package binary is missing: ${codex_bin}" >&2
  exit 1
fi

node "${APP_ROOT}/scripts/audit-codex-runtime.mjs" "${codex_bin}"
