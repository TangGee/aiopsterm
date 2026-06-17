#!/usr/bin/env bash

aiopsterm_codex_rust_toolchain() {
  local app_root="$1"
  local toolchain_file="${app_root}/codex/codex-rs/rust-toolchain.toml"
  local toolchain="${AIOPSTERM_CODEX_RUST_TOOLCHAIN:-}"

  if [[ -n "${toolchain}" ]]; then
    printf '%s\n' "${toolchain}"
    return
  fi

  if [[ ! -f "${toolchain_file}" ]]; then
    echo "[aiopsterm] Codex Rust toolchain file is missing: ${toolchain_file}" >&2
    return 1
  fi

  toolchain="$(sed -nE 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "${toolchain_file}" | head -n 1)"
  if [[ -z "${toolchain}" ]]; then
    echo "[aiopsterm] Unable to read Codex Rust toolchain channel from ${toolchain_file}" >&2
    return 1
  fi
  printf '%s\n' "${toolchain}"
}

aiopsterm_install_codex_rust_toolchain() {
  local toolchain="$1"
  local -a install_cmd=(
    rustup toolchain install "${toolchain}"
    --component clippy
    --component rustfmt
    --component rust-src
  )

  echo "[aiopsterm] installing Codex Rust toolchain ${toolchain}"
  if "${install_cmd[@]}"; then
    return
  fi

  if [[ -z "${RUSTUP_DIST_SERVER:-}" && -z "${RUSTUP_UPDATE_ROOT:-}" ]]; then
    echo "[aiopsterm] rustup default endpoint failed; retrying with rsproxy.cn mirror"
    if env \
      RUSTUP_DIST_SERVER=https://rsproxy.cn \
      RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup \
      "${install_cmd[@]}"; then
      return
    fi
  fi

  cat >&2 <<EOF
[aiopsterm] Failed to install Rust toolchain ${toolchain}.
[aiopsterm] Manual install:
[aiopsterm]   rustup toolchain install ${toolchain} --component clippy --component rustfmt --component rust-src
[aiopsterm] Mainland China mirror:
[aiopsterm]   export RUSTUP_DIST_SERVER=https://rsproxy.cn
[aiopsterm]   export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
[aiopsterm]   rustup toolchain install ${toolchain} --component clippy --component rustfmt --component rust-src
EOF
  return 1
}

aiopsterm_install_codex_rust_target() {
  local toolchain="$1"
  local target_triple="$2"
  local -a install_cmd=(
    rustup target add "${target_triple}"
    --toolchain "${toolchain}"
  )

  if "${install_cmd[@]}"; then
    return
  fi

  if [[ -z "${RUSTUP_DIST_SERVER:-}" && -z "${RUSTUP_UPDATE_ROOT:-}" ]]; then
    echo "[aiopsterm] rustup default endpoint failed while installing ${target_triple}; retrying with rsproxy.cn mirror"
    if env \
      RUSTUP_DIST_SERVER=https://rsproxy.cn \
      RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup \
      "${install_cmd[@]}"; then
      return
    fi
  fi

  cat >&2 <<EOF
[aiopsterm] Failed to install Rust target ${target_triple} for toolchain ${toolchain}.
[aiopsterm] Manual install:
[aiopsterm]   rustup target add ${target_triple} --toolchain ${toolchain}
EOF
  return 1
}

aiopsterm_codex_cargo_profile_dirname() {
  local profile="$1"
  case "${profile}" in
    dev)
      printf '%s\n' debug
      ;;
    release)
      printf '%s\n' release
      ;;
    *)
      printf '%s\n' "${profile}"
      ;;
  esac
}

aiopsterm_codex_cargo_target_dir() {
  local app_root="$1"
  local target_dir="${CARGO_TARGET_DIR:-}"
  if [[ -z "${target_dir}" ]]; then
    printf '%s\n' "${app_root}/codex/codex-rs/target"
  elif [[ "${target_dir}" = /* ]]; then
    printf '%s\n' "${target_dir}"
  else
    printf '%s\n' "${app_root}/codex/codex-rs/${target_dir}"
  fi
}

aiopsterm_find_zero_sized_rust_artifact() {
  local dir sample
  for dir in "$@"; do
    if [[ ! -d "${dir}" ]]; then
      continue
    fi
    sample="$(
      find "${dir}" -type f \
        \( -name '*.rlib' -o -name '*.rmeta' -o -name '*.o' -o -name '*.a' -o -name '*.so' -o -name '*.dylib' -o -name '*.dll' \) \
        -size 0 -print -quit
    )"
    if [[ -n "${sample}" ]]; then
      printf '%s\n' "${sample}"
      return 0
    fi
  done
  return 1
}

aiopsterm_clean_corrupt_codex_cargo_profile() {
  local app_root="$1"
  local target_triple="$2"
  local profile="$3"
  local target_root profile_dir host_profile_dir target_profile_dir corrupt_artifact

  target_root="$(aiopsterm_codex_cargo_target_dir "${app_root}")"
  profile_dir="$(aiopsterm_codex_cargo_profile_dirname "${profile}")"
  host_profile_dir="${target_root}/${profile_dir}"
  target_profile_dir="${target_root}/${target_triple}/${profile_dir}"

  corrupt_artifact="$(aiopsterm_find_zero_sized_rust_artifact "${host_profile_dir}" "${target_profile_dir}" || true)"
  if [[ -z "${corrupt_artifact}" ]]; then
    return 0
  fi

  echo "[aiopsterm] detected corrupt zero-byte Cargo artifact: ${corrupt_artifact}" >&2
  echo "[aiopsterm] cleaning Codex Cargo profile cache: ${host_profile_dir} ${target_profile_dir}" >&2
  rm -rf -- "${host_profile_dir}" "${target_profile_dir}"
}

aiopsterm_ensure_codex_rust_toolchain() {
  local app_root="$1"
  local toolchain=""
  local cargo_bin=""
  local rustc_bin=""
  toolchain="$(aiopsterm_codex_rust_toolchain "${app_root}")" || return 1

  if ! command -v rustup >/dev/null 2>&1; then
    cat >&2 <<EOF
[aiopsterm] Codex source build requires rustup and Rust toolchain ${toolchain}.
[aiopsterm] Install rustup first, then run:
[aiopsterm]   rustup toolchain install ${toolchain} --component clippy --component rustfmt --component rust-src
EOF
    return 1
  fi

  if ! rustup run "${toolchain}" rustc --version >/dev/null 2>&1; then
    aiopsterm_install_codex_rust_toolchain "${toolchain}" || return 1
  fi

  cargo_bin="$(rustup which --toolchain "${toolchain}" cargo)" || return 1
  rustc_bin="$(rustup which --toolchain "${toolchain}" rustc)" || return 1
  export RUSTUP_TOOLCHAIN="${toolchain}"
  export AIOPSTERM_CODEX_CARGO_BIN="${cargo_bin}"
  export AIOPSTERM_CODEX_RUSTC_BIN="${rustc_bin}"
  echo "[aiopsterm] using Codex Rust toolchain ${toolchain} ($("${rustc_bin}" --version))"
}
