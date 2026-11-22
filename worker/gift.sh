#!/usr/bin/env bash
# HANDOVER gift licences: free keys for family, friends, workshop places. No Stripe, no checkout.
#
#   bash gift.sh "Maria Lopez, Houston workshop"   create a key for this person and print it
#   bash gift.sh --list                            show every gift key you have made
#   bash gift.sh --revoke HX-ABCD-EFGH-JKMN        switch a key off (it stops unlocking)
#   bash gift.sh --scrub [HX-… HX-…]              one-off: rewrite every gift key in the store without the person's name
#   bash gift.sh --check [HX-… HX-…]              read the store back: is each gift key stored as "gift" only? (shows no values)
#   bash gift.sh --audit                           list the whole store by counts: gift keys not in your record, any value that is not "gift" or a sale (masked)
#   bash gift.sh --signout                         ALWAYS finish with this: locks the token keychain, removes any Cloudflare login, checks none is left
#
# TOKEN PATH (D-1, card v2.3 Rule 6): no `wrangler login`. Each Cloudflare command reads the gift token
# (service handover-cf-gift: Workers KV Storage Edit, DiSH account only) from the separate, locked keychain
# ~/Library/Keychains/handover-deploy.keychain-db into that one command's environment. You type the keychain
# password once per run; the keychain is locked again when the run ends, however it ends.
# Run only when no Claude Code session is open. Finish every sitting with --signout, then N1 v2.3.
# Keys are stored in the live licence store (Cloudflare KV, DiSH Creative account) with the marker "gift" only.
# The person's name is kept on this Mac alone, in ../private/gifts.csv (never published: private/ is git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
W="npx --yes wrangler@4.154.0"
LOG="../private/gifts.csv"
ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # same as the licence service: no 0/O/1/I/L
TOKEN_RX="oauth_token|refresh_token|api_token|authorization|bearer|token"   # what counts as a login left behind (matched without regard to case)
KC="$HOME/Library/Keychains/handover-deploy.keychain-db"; KC_SVC="handover-cf-gift"; KC_ACCT="dsimpsonh"
ACC=$(grep -E '^account_id *= *"[0-9a-f]{32}"' wrangler.toml | grep -oE '[0-9a-f]{32}' || true)
KEY_RX='^HX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'   # any HANDOVER key shape, including keys made by hand (gift.sh itself only issues the unambiguous alphabet)
N1_LINE="Now close the sitting: bash /Users/dian/Documents/Claude/Projects/Aletheai_Global/01_Engine_Engineering/dev_debt/RUN_N1_V2_3_FROM_SIGNED_CARD.sh sitting. Paste its N1 line and RESULT file name to HANDOVER tech and dev-debt."
kc_lock() { [ -e "$KC" ] && security lock-keychain "$KC" >/dev/null 2>&1 || true; }
kc_open() {   # guards, then ONE password prompt; the EXIT trap locks again however the run ends
  [ "$ACC" = "0efcbfb2427e282f755a74ce17b995d4" ] || die "wrangler.toml is not pinned to the DiSH Creative account. Nothing was done."
  [ -e "$KC" ] || die "The HANDOVER token keychain does not exist yet. Follow dev-debt's token setup first. Nothing was done."
  security find-generic-password -a "$KC_ACCT" -s "$KC_SVC" "$KC" >/dev/null 2>&1 || die "The gift token is not in the keychain (service $KC_SVC). Nothing was done."
  [ -z "${CLOUDFLARE_API_TOKEN:-}${CF_API_TOKEN:-}" ] || die "A Cloudflare token is set in this shell. Close this Terminal window and open a new one. Nothing was done."
  for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" "$HOME/.wrangler/config/default.toml" "$HOME/.config/.wrangler/config/default.toml"; do
    [ ! -e "$f" ] || die "A Cloudflare login file exists ($f). On the token path that is a deviation: run  bash gift.sh --signout  and tell dev-debt. Nothing was done."
  done
  trap kc_lock EXIT
  echo "Unlock the HANDOVER token keychain (type its password):"
  security unlock-keychain "$KC" || die "Keychain not unlocked. Nothing was done."
}
cfw() {   # ONE wrangler command with the gift token in its own environment only; never echoed, exported or written
  CLOUDFLARE_ACCOUNT_ID="$ACC" CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$KC_ACCT" -s "$KC_SVC" -w "$KC")" $W "$@"
}

mask() { printf "%s…%s" "${1:0:7}" "${1: -4}"; }   # records and read-backs show only the first and last blocks of a key
cc_open() { pgrep -x claude >/dev/null 2>&1 || pgrep -f "@anthropic-ai/claude-code" >/dev/null 2>&1; }   # a Claude Code session is running on this Mac
no_cc() { if cc_open; then die "A Claude Code session is open (process: claude, id $(pgrep -x claude | tr '\n' ' ')). Close it, then run this again. Nothing was done."; fi; }

die() { printf "\n\033[31m%s\033[0m\n" "$*" >&2; exit 1; }
[ -f "$LOG" ] || { mkdir -p ../private; echo "date,key,for,status" > "$LOG"; }

group() {   # 4 random characters from the alphabet, unbiased
  local out="" b
  while [ ${#out} -lt 4 ]; do
    b=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
    [ "$b" -lt 248 ] && out="$out${ALPHABET:$((b % 31)):1}"   # 248 = 8 * 31, so every character is equally likely
  done
  printf "%s" "$out"
}

put() {     # key, json
  local out
  if ! out=$(cfw kv key put --binding LICENCES --remote "$1" "$2" </dev/null 2>&1); then
    echo "$out" | tail -5
    if echo "$out" | grep -q "10000"; then
      die "Cloudflare refused the gift token (expired, revoked or missing permission). Do not log in instead. Tell HANDOVER tech; a new token is stored with dev-debt's setup steps (store gift)."
    fi
    die "Could not save the key. Nothing was created."
  fi
}

case "${1:-}" in
  ""|-h|--help)
    sed -n '2,14p' "$(basename "$0")" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --signout)
    CC=0; if cc_open; then CC=1; fi   # sign-out always wins: never refuse here, only report (Legal HS-1)
    kc_lock; [ -e "$KC" ] && printf "Token keychain locked.\n"
    $W logout >/dev/null 2>&1 || true
    left=0
    for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" "$HOME/.wrangler/config/default.toml" "$HOME/.config/.wrangler/config/default.toml"; do
      if [ -f "$f" ]; then n=$(grep -c -i -E "$TOKEN_RX" "$f" || true); printf "%s: %s token line(s)\n" "$f" "$n"; left=$((left + n)); else printf "%s: absent\n" "$f"; fi
    done
    [ "$CC" -eq 0 ] || printf "\nN2 DEVIATION: a Claude Code session was open during this Cloudflare sitting. Report it to Legal (time only).\n"
    [ "$left" -eq 0 ] || die "Still signed in: $left token line(s) left. Run  npx wrangler@4.154.0 logout  and then  bash gift.sh --signout  again."
    printf "\nSigned out of Cloudflare. No login is left on this Mac.\n%s\n" "$N1_LINE"; exit 0 ;;
  --scrub)
    no_cc; kc_open
    shift
    KEYS=$( { tail -n +2 "$LOG" | cut -d, -f2; printf "%s\n" "$@" | tr '[:lower:]' '[:upper:]'; } | grep -E "$KEY_RX" | sort -u || true)
    [ -n "$KEYS" ] || die "No gift keys found to rewrite."
    n=0; r=0
    for KEY in $KEYS; do
      ST=$(grep ",$KEY," "$LOG" | tail -1 | awk -F, '{print $NF}' || true)      # last recorded status wins; a key not in the record is treated as active
      DT=$(grep ",$KEY," "$LOG" | head -1 | cut -d, -f1 || true)
      if [ "$ST" = "revoked" ]; then REV=true; r=$((r + 1)); else REV=false; fi
      put "$KEY" "{\"session\":\"gift\",\"created\":\"${DT:-$(date +%F)}\",\"revoked\":$REV}"
      n=$((n + 1))
    done
    printf "\nRewrote %s gift key(s) without names (%s kept switched off). They unlock exactly as before.\nNow sign out:  bash gift.sh --signout\n" "$n" "$r"; exit 0 ;;
  --check)
    no_cc; kc_open
    shift
    KEYS=$( { tail -n +2 "$LOG" | cut -d, -f2; printf "%s\n" "$@" | tr '[:lower:]' '[:upper:]'; } | grep -E "$KEY_RX" | sort -u || true)
    [ -n "$KEYS" ] || die "No gift keys found to check."
    bad=0
    for KEY in $KEYS; do
      V=$(cfw kv key get --binding LICENCES --remote "$KEY" </dev/null 2>/dev/null || true)
      R=$(printf "%s" "$V" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const m=t.match(/\{[^{}]*\}/);let o;try{o=JSON.parse(m[0])}catch(e){console.log("NOT READ");return}const extra=Object.keys(o).filter(k=>!["session","created","revoked"].includes(k)).length;console.log((o.session==="gift"&&extra===0?"OK  ":"FIX ")+" session is gift: "+(o.session==="gift"?"yes":"NO")+" · extra fields: "+(extra?"YES":"no")+" · switched off: "+(o.revoked===true?"yes":"no"))})' 2>/dev/null || echo "NOT READ")
      case "$R" in OK*) ;; *) bad=$((bad + 1)) ;; esac
      printf "%s  %s\n" "$(mask "$KEY")" "$R"
    done
    [ "$bad" -eq 0 ] || die "$bad key(s) need attention. Run  bash gift.sh --scrub  and check again."
    printf "\nAll gift keys are stored without names.\nNow sign out:  bash gift.sh --signout\n"; exit 0 ;;
  --audit)
    no_cc; kc_open
    ALL=$(cfw kv key list --binding LICENCES --remote </dev/null 2>/dev/null | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{JSON.parse(t.slice(t.indexOf("["))).forEach(k=>console.log(k.name))}catch(e){process.exit(3)}})') || die "Could not list the store. Nothing was changed."
    total=0; gift=0; sale=0; other=0; unrec=0
    for KEY in $ALL; do
      total=$((total + 1))
      V=$(cfw kv key get --binding LICENCES --remote "$KEY" </dev/null 2>/dev/null || true)
      K=$(printf "%s" "$V" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const m=t.match(/\{[^{}]*\}/);let o;try{o=JSON.parse(m[0])}catch(e){console.log("unread");return}const s=String(o.session||"");console.log(s==="gift"?"gift":(/^cs_(live|test)_/.test(s)?"sale":"other"))})' 2>/dev/null || echo unread)
      case "$K" in
        gift) gift=$((gift + 1)); grep -q ",$KEY," "$LOG" || { unrec=$((unrec + 1)); printf "%s  gift key NOT in private/gifts.csv\n" "$(mask "$KEY")"; } ;;
        sale) sale=$((sale + 1)) ;;
        *) other=$((other + 1)); printf "%s  value is not plain \"gift\" or a sale: fix with  bash gift.sh --scrub %s\n" "$(mask "$KEY")" "$KEY" ;;
      esac
    done
    printf "\nStore: %s key(s) · gift %s · sales %s · other %s · gift keys missing from your record %s\nNow sign out:  bash gift.sh --signout\n" "$total" "$gift" "$sale" "$other" "$unrec"; exit 0 ;;
  --list)
    column -s, -t < "$LOG" 2>/dev/null || cat "$LOG"; exit 0 ;;
  --revoke)
    no_cc
    KEY=$(printf "%s" "${2:-}" | tr '[:lower:]' '[:upper:]')
    [[ "$KEY" =~ $KEY_RX ]] || die "That doesn't look like a HANDOVER key."
    kc_open
    WHO=$(grep ",$KEY," "$LOG" | head -1 | cut -d, -f3 || true)
    put "$KEY" "{\"session\":\"gift\",\"created\":\"$(date +%F)\",\"revoked\":true}"
    echo "$(date +%F),$KEY,${WHO:-unknown},revoked" >> "$LOG"
    printf "\nRevoked %s%s. It no longer unlocks HANDOVER.\n" "$KEY" "${WHO:+ ($WHO)}"; exit 0 ;;
esac

WHO=$(printf "%s" "$*" | sed 's/,/ ·/g' | tr -d '"\\' | tr -s ' ')   # commas and quotes would break the record
[ -n "$WHO" ] || die "Say who the key is for, e.g.  bash gift.sh \"Maria Lopez, Houston workshop\""
no_cc; kc_open
KEY="HX-$(group)-$(group)-$(group)"
put "$KEY" "{\"session\":\"gift\",\"created\":\"$(date +%F)\",\"revoked\":false}"
echo "$(date +%F),$KEY,$WHO,active" >> "$LOG"

cat <<EOF

  Gift licence for $WHO:

      $KEY

  Send them:
      1. Open https://handover.dianasimpsonhernandez.com/app/
      2. Choose a folder, then paste the key into the unlock box.

  Recorded in private/gifts.csv. To switch it off later:  bash gift.sh --revoke $KEY

  When you have finished making keys, sign out:  bash gift.sh --signout

EOF
