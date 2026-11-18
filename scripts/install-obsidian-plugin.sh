#!/usr/bin/env bash
# Install the built Markdone Obsidian plugin into one or more vaults.
#
#   scripts/install-obsidian-plugin.sh [--dry-run] [--build] <vault> [<vault> ...]
#
# Copies main.js, manifest.json, and styles.css from the plugin's build output into
# <vault>/.obsidian/plugins/markdone/. Never touches data.json (the plugin's settings).
# Each file is written to a temp name and renamed into place, so Obsidian or iCloud
# never sees a half-written main.js. Vaults may also come from $MARKDONE_VAULTS
# (colon-separated) when no vault is given. --dry-run wins over --build: it builds nothing
# and writes nothing. Through npm: `npm run install:obsidian -- --dry-run <vault>`.
set -euo pipefail

# Path of the plugin's build output, relative to the repo root. Adjust to the repo layout.
PLUGIN_DIR="${PLUGIN_DIR:-packages/obsidian}"
FILES=(main.js manifest.json styles.css)

dry_run=0 build=0 vaults=()
for a in "$@"; do
  case "$a" in
    --dry-run) dry_run=1 ;;
    --build) build=1 ;;
    -h|--help) sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p;}' "$0"; exit 0 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) vaults+=("$a") ;;
  esac
done
# `npm run install:obsidian --dry-run` gives --dry-run to npm, not to this script; npm
# exports it as npm_config_dry_run. Honor it, so a dry run through npm never writes.
[ "${npm_config_dry_run:-}" = true ] && dry_run=1
# A dry run writes nothing, so it skips the build too and reports the existing build output.
[ "$dry_run" = 1 ] && build=0
if [ ${#vaults[@]} -eq 0 ] && [ -n "${MARKDONE_VAULTS:-}" ]; then
  IFS=: read -r -a vaults <<< "$MARKDONE_VAULTS"
fi
[ ${#vaults[@]} -gt 0 ] || { echo "usage: $0 [--dry-run] [--build] <vault> [...]" >&2; exit 2; }

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/$PLUGIN_DIR"

if [ "$build" = 1 ]; then
  (cd "$src" && npm run build)
fi

for f in "${FILES[@]}"; do
  [ -f "$src/$f" ] || { echo "missing $src/$f (build the plugin first, or pass --build)" >&2; exit 1; }
done
version() { { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" 2>/dev/null || true; } | head -1; }
id=$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$src/manifest.json" | head -1)
[ "$id" = markdone ] || { echo "$src/manifest.json has id '$id', expected 'markdone'" >&2; exit 1; }
new=$(version "$src/manifest.json")

found=0
for v in "${vaults[@]}"; do
  [ -d "$v/.obsidian" ] || { echo "skip: $v is not an Obsidian vault (no .obsidian/)" >&2; continue; }
  found=1
  dest="$v/.obsidian/plugins/markdone"
  old=$(version "$dest/manifest.json"); old=${old:-none}
  echo "$(basename "$v"): $old -> $new"
  [ "$dry_run" = 1 ] && continue
  mkdir -p "$dest"
  for f in "${FILES[@]}"; do
    cp "$src/$f" "$dest/.$f.tmp"
    mv -f "$dest/.$f.tmp" "$dest/$f"
  done
done
[ "$found" = 1 ] || { echo "no Obsidian vault found among the given paths; nothing installed" >&2; exit 1; }
[ "$dry_run" = 1 ] && { echo "(dry run: nothing built or written)"; exit 0; }
echo "Reload in Obsidian: Settings > Community plugins > Markdone off and on, or restart Obsidian."
