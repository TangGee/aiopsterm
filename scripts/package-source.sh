#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_root=$(git -C "$script_dir/.." rev-parse --show-toplevel)
project_name=$(basename "$project_root")
codex_root="$project_root/codex"

if [[ ! -e "$codex_root/.git" ]]; then
  echo "Codex source repository is missing: $codex_root" >&2
  exit 1
fi

timestamp=$(date '+%Y%m%d-%H%M%S')
commit=$(git -C "$project_root" rev-parse --short HEAD)
archive_name="${project_name}-source-${commit}-${timestamp}.tar.gz"
output_dir=${1:-"$project_root/release/source"}

mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)
archive_path="$output_dir/$archive_name"

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/${project_name}-source.XXXXXX")
staging_root="$temp_dir/$project_name"
archive_list="$temp_dir/archive-files"
trap 'rm -rf "$temp_dir"' EXIT

snapshot_repository() {
  local source_repository=$1
  local staged_repository=$2
  local snapshot_label=$3
  shift 3
  local diff_file="$temp_dir/${snapshot_label}-working-tree.patch"
  local untracked_list="$temp_dir/${snapshot_label}-untracked"
  local path

  git -C "$source_repository" diff --binary --full-index HEAD -- "$@" > "$diff_file"
  if [[ -s "$diff_file" ]]; then
    git -C "$staged_repository" apply --index "$diff_file"
  fi

  while IFS= read -r -d '' path; do
    case "$snapshot_label/$path" in
      root/codex|root/codex/*|root/release|root/release/*)
        continue
        ;;
    esac
    printf '%s\0' "$path" >> "$untracked_list"
  done < <(git -C "$source_repository" ls-files -z --others --exclude-standard)

  if [[ -s "$untracked_list" ]]; then
    tar -C "$source_repository" --null --files-from="$untracked_list" -cf - | tar -C "$staged_repository" -xf -
    git -C "$staged_repository" add --all
  fi

  if ! git -C "$staged_repository" diff --cached --quiet; then
    git \
      -C "$staged_repository" \
      -c user.name='aiopsterm source packager' \
      -c user.email='source-packager@aiopsterm.invalid' \
      -c commit.gpgsign=false \
      commit --quiet -m "Source snapshot for $snapshot_label packaging"
  fi

  if [[ -n "$(git -C "$staged_repository" status --porcelain)" ]]; then
    echo "Staged source repository is not clean: $staged_repository" >&2
    exit 1
  fi
}

git clone --quiet --no-hardlinks --no-recurse-submodules "$project_root" "$staging_root"
snapshot_repository \
  "$project_root" \
  "$staging_root" \
  root \
  . \
  ':(exclude)codex' \
  ':(exclude)codex/**' \
  ':(exclude)release' \
  ':(exclude)release/**'

git clone --quiet --no-hardlinks --no-recurse-submodules "$codex_root" "$staging_root/codex"
snapshot_repository "$codex_root" "$staging_root/codex" codex .

tar -C "$temp_dir" -czf "$archive_path" "$project_name"
tar -tzf "$archive_path" > "$archive_list"

for required_path in \
  "$project_name/package.json" \
  "$project_name/package-lock.json" \
  "$project_name/.git/HEAD" \
  "$project_name/codex/.git/HEAD" \
  "$project_name/codex/codex-rs/Cargo.toml" \
  "$project_name/codex/scripts/build_codex_package.py"; do
  if ! grep -Fxq "$required_path" "$archive_list"; then
    echo "Archive is missing required source: $required_path" >&2
    exit 1
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$archive_path" > "$archive_path.sha256"
else
  shasum -a 256 "$archive_path" > "$archive_path.sha256"
fi

echo "Source archive created: $archive_path"
echo "Checksum created: $archive_path.sha256"
