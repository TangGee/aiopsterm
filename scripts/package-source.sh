#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_root=$(git -C "$script_dir/.." rev-parse --show-toplevel)
project_parent=$(dirname "$project_root")
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
file_list="$temp_dir/files"
archive_list="$temp_dir/archive-files"
trap 'rm -rf "$temp_dir"' EXIT

append_repository_files() {
  local repository=$1
  local archive_prefix=$2
  local path

  while IFS= read -r -d '' path; do
    if [[ ! -e "$repository/$path" && ! -L "$repository/$path" ]]; then
      echo "Tracked source file is missing: $repository/$path" >&2
      exit 1
    fi
    printf '%s\0' "$archive_prefix/$path" >> "$file_list"
  done < <(git -C "$repository" ls-files -z --cached --others --exclude-standard)
}

while IFS= read -r -d '' path; do
  case "$path" in
    external-reference|external-reference/*|codex|codex/*|control_compat|control_compat/*|release|release/*)
      continue
      ;;
  esac
  if [[ ! -e "$project_root/$path" && ! -L "$project_root/$path" ]]; then
    echo "Tracked source file is missing: $project_root/$path" >&2
    exit 1
  fi
  printf '%s\0' "$project_name/$path" >> "$file_list"
done < <(git -C "$project_root" ls-files -z --cached --others --exclude-standard)

append_repository_files "$codex_root" "$project_name/codex"

printf '%s\0' "$project_name/.git" >> "$file_list"
printf '%s\0' "$project_name/codex/.git" >> "$file_list"

tar \
  -C "$project_parent" \
  --exclude="$project_name/.git/modules/external-reference" \
  --exclude="$project_name/.git/modules/external-reference/*" \
  --null \
  --files-from="$file_list" \
  -czf "$archive_path"
tar -tzf "$archive_path" > "$archive_list"

if grep -Eq "^${project_name}/(external-reference|control_compat)(/|$)" "$archive_list"; then
  echo "Archive contains a forbidden source tree" >&2
  exit 1
fi

if grep -Eq "^${project_name}/\\.git/modules/external-reference(/|$)" "$archive_list"; then
  echo "Archive contains External reference Git objects" >&2
  exit 1
fi

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
