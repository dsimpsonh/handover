#!/usr/bin/env bash
# HANDOVER licence service: deploy to Cloudflare Workers with the scoped API token (D-1).
# PROPOSED replacement for worker/deploy.sh (v2, locked-keychain pattern) — NOT IN USE until Legal's joint ack and the tokens exist.
# Run from Terminal on your Mac, in a card sitting:   cd ~/Sites/handover/worker && bash deploy.sh
# No `wrangler login`, ever (card v2.3 Rule 6). The deploy token lives in the separate, locked keychain
# ~/Library/Keychains/handover-deploy.keychain-db. In ONE line the script unlocks it (you type its password), reads the
# token into ONE command's environment, and locks it again; an exit trap also locks it. The token is never
# echoed, exported, written to a file or placed in shell history. Secrets and the KV store already exist;
# this script only redeploys the code. Changing a secret is done in the Cloudflare dashboard.
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
fail() { printf "\n\033[31m%s\033[0m\n" "$*"; exit 1; }
KC="$HOME/Library/Keychains/handover-deploy.keychain-db"; KC_ACCOUNT="dsimpsonh"; KC_SERVICE="handover-cf-deploy"
kc_lock() { [ -e "$KC" ] && security lock-keychain "$KC" >/dev/null 2>&1 || true; }
trap kc_lock EXIT
W="npx --yes wrangler@4.154.0"

say "1/5  Guards"
# Never start while a Claude Code session is open on this Mac (card v2.2 rule; unchanged from the current script).
if pgrep -x claude >/dev/null 2>&1 || pgrep -f "@anthropic-ai/claude-code" >/dev/null 2>&1; then
  fail "A Claude Code session is open on this Mac. Close it, then run this again. Nothing was done."
fi
# No Cloudflare OAuth login may exist: the token path replaces it. Same three paths N1 checks (wrangler-cfg).
for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" "$HOME/.config/.wrangler/config/default.toml" "$HOME/.wrangler/config/default.toml"; do
  [ ! -e "$f" ] || fail "A Cloudflare login file exists ($f). Run  bash gift.sh --signout  first. Nothing was done."
done
# No Cloudflare token may already sit in this shell's environment (N1 cf-env must read 0 before and after).
[ -z "${CLOUDFLARE_API_TOKEN:-}${CF_API_TOKEN:-}" ] || fail "A Cloudflare token is set in this shell. Close this Terminal window and open a new one. Nothing was done."
# The token keychain and the deploy item must exist. Presence only (attributes); the value is not read here.
[ -e "$KC" ] || fail "The HANDOVER token keychain does not exist yet. Follow dev-debt's token setup first. Nothing was done."
security find-generic-password -a "$KC_ACCOUNT" -s "$KC_SERVICE" "$KC" >/dev/null 2>&1 \
  || fail "The deploy token is not in the keychain (service $KC_SERVICE). Follow dev-debt's token steps first. Nothing was done."

say "2/5  Checking Node.js and files"
command -v node >/dev/null || fail "Node.js is not installed. Install it with:  brew install node, then run this again."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $NODE_MAJOR is too old; Wrangler needs Node 20+.  brew upgrade node"
[ -f ../private/fragments.json ] || fail "../private/fragments.json is missing; the service bundles it. Nothing was done."
grep -q 'REPLACE_WITH_KV_NAMESPACE_ID' wrangler.toml && fail "wrangler.toml has no KV id. This script does not create stores. Nothing was done."

say "3/5  Cloudflare account (DiSH Creative only)"
ACC=$(grep -E '^account_id *= *"[0-9a-f]{32}"' wrangler.toml | grep -oE '[0-9a-f]{32}' || true)
[ "$ACC" = "0efcbfb2427e282f755a74ce17b995d4" ] || fail "wrangler.toml is not pinned to the DiSH Creative account. Nothing was done."
echo "Pinned to account $ACC."

say "4/5  Deploying the service"
# Unlock -> ONE command with the token in its own environment -> lock, in one line. Output is captured; Wrangler does not print the token.
echo "Unlock the HANDOVER token keychain (type its password):"
RC=0; security unlock-keychain "$KC" && { DEPLOY_OUT=$(CLOUDFLARE_ACCOUNT_ID="$ACC" CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$KC_ACCOUNT" -s "$KC_SERVICE" -w "$KC")" $W deploy </dev/null 2>&1) || RC=$?; } || RC=$?; kc_lock
[ "$RC" -eq 0 ] || { echo "${DEPLOY_OUT:-}" | tail -15; fail "Deploy failed or the keychain was not unlocked (see above). If it names a missing permission, send that line to HANDOVER tech. Do not widen the token yourself, and do not log in instead."; }
echo "$DEPLOY_OUT" | tail -5
URL=$(printf "%s" "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || URL="https://handover-api.dish-creative.workers.dev"

say "5/5  Health check"
sleep 3
curl -fsS "$URL/health" && echo
cat <<'EOF2'

Done. No Cloudflare login was used and none is left behind. The token keychain is locked.
Now close the sitting: bash /Users/dian/Documents/Claude/Projects/Aletheai_Global/01_Engine_Engineering/dev_debt/RUN_N1_V2_3_FROM_SIGNED_CARD.sh sitting. Paste its N1 line and RESULT file name to HANDOVER tech and dev-debt.
EOF2
