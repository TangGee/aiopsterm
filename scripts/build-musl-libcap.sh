#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

version='2.32'
sha256='1005e3d227f2340ad1e3360ef8b69d15e3c72a29c09f4894d7aac038bd26e2be'
target_triple="${1:-x86_64-unknown-linux-musl}"
cache_root="${APP_ROOT}/.cache/aiopsterm-libcap-${version}-${target_triple}-v1"
prefix="${cache_root}/prefix"

if [[ -f "${prefix}/lib/libcap.a" && -f "${prefix}/lib/pkgconfig/libcap.pc" ]]; then
  printf '%s\n' "${prefix}"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo '[aiopsterm] curl is required to build musl libcap.' >&2; exit 1; }
command -v make >/dev/null 2>&1 || { echo '[aiopsterm] make is required to build musl libcap.' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo '[aiopsterm] sha256sum is required to verify musl libcap.' >&2; exit 1; }

cc_env_name="CC_${target_triple//-/_}"
musl_cc="${!cc_env_name:-}"
if [[ -z "${musl_cc}" ]]; then
  musl_cc="$(command -v "${target_triple/-unknown/}-gcc" 2>/dev/null || command -v musl-gcc 2>/dev/null || true)"
fi
[[ -n "${musl_cc}" ]] || { echo "[aiopsterm] no musl compiler found for ${target_triple}." >&2; exit 1; }

multiarch=''
if command -v dpkg-architecture >/dev/null 2>&1; then
  multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
fi
include_flags='-idirafter/usr/include'
[[ -z "${multiarch}" ]] || include_flags="${include_flags} -idirafter/usr/include/${multiarch}"

mirror_root="${AIOPSTERM_LIBCAP_MIRROR:-https://mirrors.nju.edu.cn/kernel.org/linux/libs/security/linux-privs/libcap2}"
archive_url="${mirror_root%/}/libcap-${version}.tar.xz"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/aiopsterm-libcap.XXXXXX")"
trap 'rm -rf "${work_dir}"' EXIT

archive="${work_dir}/libcap-${version}.tar.xz"
echo "[aiopsterm] downloading libcap ${version} from ${mirror_root}" >&2
curl --fail --location --retry 3 --connect-timeout 20 --max-time 180 "${archive_url}" -o "${archive}"
printf '%s  %s\n' "${sha256}" "${archive}" | sha256sum -c - >&2
tar -xf "${archive}" -C "${work_dir}"
source_dir="${work_dir}/libcap-${version}"

mkdir -p "${prefix}"
make -C "${source_dir}/libcap" all \
  CC="${musl_cc}" \
  BUILD_CC="${CC:-cc}" \
  AR="${AR:-ar}" \
  RANLIB="${RANLIB:-ranlib}" \
  BUILD_GPERF=no \
  prefix="${prefix}" \
  lib=lib \
  CFLAGS="-O2 -D_LARGEFILE64_SOURCE -D_FILE_OFFSET_BITS=64 ${include_flags}" >&2
mkdir -p "${prefix}/include/sys" "${prefix}/lib/pkgconfig"
install -m 0644 "${source_dir}/libcap/include/sys/capability.h" "${prefix}/include/sys/capability.h"
install -m 0644 "${source_dir}/libcap/include/sys/psx_syscall.h" "${prefix}/include/sys/psx_syscall.h"
install -m 0644 "${source_dir}/libcap/libcap.a" "${prefix}/lib/libcap.a"
install -m 0644 "${source_dir}/libcap/libcap.pc" "${prefix}/lib/pkgconfig/libcap.pc"

printf '%s\n' "${prefix}"
