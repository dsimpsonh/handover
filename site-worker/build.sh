#!/usr/bin/env bash
# HANDOVER site build (HO-8): makes site-worker/dist/ from the LAST COMMIT, public site files only.
#   bash build.sh            build dist/ and print its file list with sha256
# It never reads the working tree, so nothing uncommitted, ignored or private can get in.
# No login, no network. Safe to run at any time.
set -euo pipefail
cd "$(dirname "$0")"
ALLOW="index.html favicon.ico _headers app checkout terms privacy assets js engine vendor"   # everything else in the repo stays out
DIST="${DIST:-./dist}"
die() { printf "\n\033[31m%s\033[0m\n" "$*" >&2; exit 1; }
ROOT=$(git rev-parse --show-toplevel)
REV=$(git -C "$ROOT" rev-parse HEAD)
for p in $ALLOW; do git -C "$ROOT" cat-file -e "HEAD:$p" 2>/dev/null || die "Not in the last commit: $p"; done
rm -rf "$DIST"; mkdir -p "$DIST"
git -C "$ROOT" archive --format=tar HEAD $ALLOW | tar -x -C "$DIST"
# Controls: the copy must hold site files only.
BAD=$(cd "$DIST" && find . -type f | grep -i -E '(^|/)(private|worker|tests|site-worker|brand)/|\.env|\.dev\.vars|gifts\.csv|fragments\.json|\.md$|\.sh$|\.toml$|\.sha256$|(^|/)CNAME$|(^|/)\.git' || true)
[ -z "$BAD" ] || die "Stopped: files that must not be published are in dist: $BAD"
[ -f "$DIST/index.html" ] && [ -f "$DIST/app/index.html" ] && [ -f "$DIST/checkout/index.html" ] || die "Stopped: a main page is missing from dist."
N=$(cd "$DIST" && find . -type f | wc -l | tr -d ' ')
BIG=$(cd "$DIST" && find . -type f -size +25M | head -1)
[ -z "$BIG" ] || die "Stopped: $BIG is over Cloudflare's 25 MB per-file limit."
( cd "$DIST" && find . -type f | LC_ALL=C sort | while read -r f; do printf "%s  %s\n" "$( (shasum -a 256 "$f" 2>/dev/null || sha256sum "$f") | cut -d' ' -f1)" "${f#./}"; done ) > DIST_MANIFEST.txt
printf "Built %s files from commit %s into %s\nFile list with sha256: %s/DIST_MANIFEST.txt\n" "$N" "${REV:0:7}" "$DIST" "$(pwd)"
