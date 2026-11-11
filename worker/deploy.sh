#!/usr/bin/env bash
# HANDOVER licence service: one-command deploy to Cloudflare Workers.
# Run from Terminal on your Mac:   cd ~/Sites/handover/worker && bash deploy.sh
# Safe to run again: it skips anything already set up. Secrets are typed into hidden prompts, never echoed or saved.
# It signs you out of Cloudflare when it ends, so each run asks you to log in again. Close Claude Code before running it.
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
fail() { printf "\n\033[31m%s\033[0m\n" "$*"; exit 1; }

# Sign-in safety (Legal & Compliance, 11 Nov 2026).
# 1. Never start while a Claude Code session is open on this Mac.
# 2. Always sign out of Cloudflare when this script ends, however it ends: finished, failed, Ctrl-C or closed window.
if pgrep -x claude >/dev/null 2>&1 || pgrep -f "@anthropic-ai/claude-code" >/dev/null 2>&1; then
  fail "A Claude Code session is open on this Mac. Close it, then run this again. Nothing was done."
fi
signout_on_exit() {
  rc=$?; trap - EXIT INT TERM HUP
  say "Signing out of Cloudflare"
  if bash ./gift.sh --signout; then :; else
    printf "\n\033[31m%s\033[0m\n" "NOT SIGNED OUT. Run:  bash gift.sh --signout"
    [ "$rc" -ne 0 ] || rc=1
  fi
  exit "$rc"
}
trap signout_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

say "1/6  Checking Node.js"
command -v node >/dev/null || fail "Node.js is not installed. Install it with:  brew install node   (or from nodejs.org), then run this again."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $NODE_MAJOR is too old; Wrangler needs Node 20+.  brew upgrade node"
W="npx --yes wrangler@4"
[ -f ../private/fragments.json ] || fail "../private/fragments.json is missing; the service bundles it. Restore it from the tech thread before deploying."

say "2/6  Cloudflare account (HANDOVER must deploy to the DiSH Creative account, never Aletheai's)"
if grep -qE '^account_id *= *"[0-9a-f]{32}"' wrangler.toml; then
  echo "Pinned to account $(grep -oE '[0-9a-f]{32}' <<<"$(grep '^account_id' wrangler.toml)")."
  $W whoami 2>/dev/null | grep -qi "logged in" || $W login
else
  if $W whoami 2>/dev/null | grep -qi "logged in"; then
    echo "Wrangler is already logged in to:"; $W whoami 2>/dev/null | grep -iE "email|account" || true
    read -r -p "Is this the DiSH Creative / HANDOVER account? Type yes to continue, anything else to log out and switch: " OK
    if [ "$OK" != "yes" ]; then $W logout; $W login; fi
  else
    $W login
  fi
  WHO=$($W whoami 2>/dev/null)
  echo "$WHO" | grep -iE "email|account" || true
  IDS=$(printf "%s" "$WHO" | grep -oE '[0-9a-f]{32}' | sort -u)
  if [ "$(printf "%s\n" "$IDS" | grep -c .)" = "1" ]; then ACC="$IDS"
  else read -r -p "Paste the Account ID of the DiSH Creative account from the list above: " ACC; fi
  [[ "$ACC" =~ ^[0-9a-f]{32}$ ]] || fail "That is not a Cloudflare Account ID."
  read -r -p "Deploy HANDOVER to account $ACC? Type yes: " OK
  [ "$OK" = "yes" ] || fail "Stopped. Nothing was deployed."
  awk -v acc="$ACC" '{print} /^main = /{print "account_id = \"" acc "\""}' wrangler.toml > wrangler.toml.tmp && mv wrangler.toml.tmp wrangler.toml
  echo "Pinned: every future deploy goes to $ACC only."
fi

say "3/6  Licence store (Cloudflare KV)"
if grep -q 'REPLACE_WITH_KV_NAMESPACE_ID' wrangler.toml; then
  OUT=$($W kv namespace create LICENCES --binding LICENCES </dev/null 2>&1) || { echo "$OUT"; fail "Could not create the KV namespace."; }
  KV_ID=$(printf "%s" "$OUT" | grep -oE '"?id"?[ =:]+"?[0-9a-f]{32}' | grep -oE '[0-9a-f]{32}' | head -1)
  [ -n "$KV_ID" ] || { echo "$OUT"; fail "Could not read the new namespace id from Wrangler's output."; }
  sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "Created LICENCES store: $KV_ID (saved in wrangler.toml)"
else
  echo "LICENCES store already configured."
fi

say "4/6  Deploying the service"
DEPLOY_OUT=$($W deploy </dev/null 2>&1) || { echo "$DEPLOY_OUT"; fail "Deploy failed (see above). If it asks you to choose a workers.dev subdomain, run  npx wrangler@4 deploy  once on its own, answer the question, then run this script again."; }
echo "$DEPLOY_OUT" | tail -5
URL=$(printf "%s" "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || fail "Deployed, but could not read the service address. Find it in the Cloudflare dashboard under Workers."

say "5/6  Secrets (typed into hidden prompts)"
SECRETS=$($W secret list 2>/dev/null || true)
if ! printf "%s" "$SECRETS" | grep -q LICENCE_SECRET; then
  openssl rand -hex 32 | $W secret put LICENCE_SECRET >/dev/null
  echo "LICENCE_SECRET generated and stored. Never change it: existing keys are derived from it."
else echo "LICENCE_SECRET already set (kept)."; fi
if ! printf "%s" "$SECRETS" | grep -q STRIPE_SECRET_KEY; then
  echo "Paste your Stripe RESTRICTED key (rk_live_…) and press Enter. Nothing will show as you paste:"
  $W secret put STRIPE_SECRET_KEY
else echo "STRIPE_SECRET_KEY already set (to replace it: $W secret put STRIPE_SECRET_KEY)."; fi
if ! printf "%s" "$SECRETS" | grep -q STRIPE_WEBHOOK_SECRET; then
  cat <<EOF

Now add the webhook in Stripe:
  Developers → Webhooks → Add destination
  Events: checkout.session.completed  and  checkout.session.async_payment_succeeded
  Endpoint URL:  $URL/stripe-webhook
Then copy its signing secret (whsec_…).
EOF
  echo "Paste the signing secret (whsec_…) and press Enter. Nothing will show as you paste:"
  $W secret put STRIPE_WEBHOOK_SECRET
else echo "STRIPE_WEBHOOK_SECRET already set."; fi

say "6/6  Health check"
sleep 3
curl -fsS "$URL/health" && echo
cat <<EOF

Done. Send the tech thread this address (it is not secret):

    $URL

Webhook endpoint (for reference):  $URL/stripe-webhook
EOF
