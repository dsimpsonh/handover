#!/usr/bin/env bash
# HANDOVER site -> Cloudflare (HO-8). Diana runs this in her own Terminal, with every Claude Code window closed.
# DO NOT RUN until Legal has accepted this file and the deploy credential (D-1) is decided, or as a rule card v2.1 sitting.
#
#   bash deploy-site.sh workers    Workers static assets  -> https://handover-site.<your-subdomain>.workers.dev
#   bash deploy-site.sh pages      Cloudflare Pages upload -> https://handover-site.pages.dev
#
# It builds the copy from the last commit, uploads it, checks it against the live site, and signs out of Cloudflare
# when it ends, however it ends. It never touches the domain, DNS or GitHub Pages. Afterwards run the N1 runner:
#   the rule card's N1 runner, kind "sitting" (RUN_N1_V2_1_FROM_SIGNED_CARD.sh, kept with the rule card)
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
fail() { printf "\n\033[31m%s\033[0m\n" "$*"; exit 1; }

MODE="${1:-}"
case "$MODE" in workers|pages) ;; *) fail "Say where to put the copy:  bash deploy-site.sh workers   or   bash deploy-site.sh pages" ;; esac
LIVE="${LIVE_URL:-https://handover.dianasimpsonhernandez.com}"

if pgrep -x claude >/dev/null 2>&1 || pgrep -f "@anthropic-ai/claude-code" >/dev/null 2>&1; then
  fail "A Claude Code session is open on this Mac. Close it, then run this again. Nothing was done."
fi
signout_on_exit() {
  rc=$?; trap - EXIT INT TERM HUP
  say "Signing out of Cloudflare"
  if bash "$HERE/../worker/gift.sh" --signout; then :; else
    printf "\n\033[31m%s\033[0m\n" "NOT SIGNED OUT. Run:  bash ../worker/gift.sh --signout"
    [ "$rc" -ne 0 ] || rc=1
  fi
  exit "$rc"
}
trap signout_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

W="npx --yes wrangler@4.154.0"
ACC=$(grep -oE '^account_id *= *"[0-9a-f]{32}"' wrangler.toml | grep -oE '[0-9a-f]{32}') || fail "wrangler.toml has no pinned account_id."
[ "$ACC" = "$(grep -oE '^account_id *= *"[0-9a-f]{32}"' ../worker/wrangler.toml | grep -oE '[0-9a-f]{32}')" ] || fail "The site and the licence service are pinned to different Cloudflare accounts. Stopped."

say "1/4  Building the copy from the last commit"
bash ./build.sh

say "2/4  Cloudflare account (DiSH Creative; pinned to $ACC)"
$W whoami 2>/dev/null | grep -qi "logged in" || $W login

say "3/4  Uploading ($MODE)"
if [ "$MODE" = "workers" ]; then
  OUT=$($W deploy </dev/null 2>&1) || { echo "$OUT"; fail "Upload failed (see above). Nothing about the live site was changed."; }
  echo "$OUT" | tail -4
  URL=$(printf "%s" "$OUT" | grep -oE 'https://handover-site\.[a-z0-9.-]+\.workers\.dev' | head -1)
else
  TMP=$(mktemp -d); export CLOUDFLARE_ACCOUNT_ID="$ACC"
  ( cd "$TMP" && { $W pages project list 2>/dev/null | grep -q "handover-site" || $W pages project create handover-site --production-branch main; } )
  OUT=$(cd "$TMP" && $W pages deploy "$HERE/dist" --project-name handover-site --branch main --commit-dirty=true </dev/null 2>&1) || { echo "$OUT"; fail "Upload failed (see above). Nothing about the live site was changed."; }
  echo "$OUT" | tail -4
  URL="https://handover-site.pages.dev"
fi
[ -n "$URL" ] || fail "Uploaded, but could not read the copy's address. Find it in the Cloudflare dashboard under Workers & Pages."

say "4/4  Checking the copy against the live site"
if [ "${SKIP_PARITY:-}" = "1" ]; then echo "Parity check skipped (SKIP_PARITY=1)."; else
  sleep 8
  mkdir -p ../private
  REP="../private/PARITY_$(date -u +%Y%m%dT%H%M%SZ).md"
  if python3 ./parity.py "$LIVE" "$URL" > "$REP"; then tail -1 "$REP"; else tail -3 "$REP"; echo "Full table: $REP"; fail "The copy does not match the live site. The live site is unaffected."; fi
  echo "Full table: $REP   (send this file to the HANDOVER tech thread)"
fi

cat <<MSG

Done. The copy is at:

    $URL

The live site is unchanged: GitHub Pages still serves handover.dianasimpsonhernandez.com.
Now finish the sitting with the N1 runner (the line at the top of this file).
MSG
