#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

codex_bin="${AIOPSTERM_CODEX_BIN:-${APP_ROOT}/codex/codex-rs/target/release/codex}"

if [[ -n "${AIOPSTERM_CODEX_BIN:-}" ]]; then
  if [[ ! -x "${codex_bin}" ]]; then
    echo "[aiopsterm] AIOPSTERM_CODEX_BIN is not executable: ${codex_bin}" >&2
    exit 1
  fi
  echo "[aiopsterm] using Codex CLI binary from AIOPSTERM_CODEX_BIN: ${codex_bin}"
elif [[ -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex CLI binary exists: ${codex_bin}"
elif [[ -d "${APP_ROOT}/codex/codex-rs" ]]; then
  echo "[aiopsterm] building Codex CLI binary"
  (cd "${APP_ROOT}/codex/codex-rs" && cargo build --release -p codex-cli)
else
  echo "[aiopsterm] Codex source directory is missing: ${APP_ROOT}/codex/codex-rs" >&2
  echo "[aiopsterm] set AIOPSTERM_CODEX_BIN to a valid Codex binary or place Codex at codex/codex-rs." >&2
  exit 1
fi

if [[ ! -x "${codex_bin}" ]]; then
  echo "[aiopsterm] Codex CLI binary is missing: ${codex_bin}" >&2
  exit 1
fi
