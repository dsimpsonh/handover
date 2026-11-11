#!/usr/bin/env bash
# HANDOVER gift licences: free keys for family, friends, workshop places. No Stripe, no checkout.
#
#   bash gift.sh "Maria Lopez, Houston workshop"   create a key for this person and print it
#   bash gift.sh --list                            show every gift key you have made
#   bash gift.sh --revoke HX-ABCD-EFGH-JKMN        switch a key off (it stops unlocking)
#   bash gift.sh --scrub [HX-… HX-…]              one-off: rewrite every gift key in the store without the person's name
#   bash gift.sh --check [HX-… HX-…]              read the store back: is each gift key stored as "gift" only? (shows no values)
#   bash gift.sh --signout                         ALWAYS finish with this: signs out of Cloudflare and checks no login is left
#
# Sign in to Cloudflare only when no Claude Code session is open. Finish every sitting with --signout.
# Keys are stored in the live licence store (Cloudflare KV, DiSH Creative account) with the marker "gift" only.
# The person's name is kept on this Mac alone, in ../private/gifts.csv (never published: private/ is git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
W="npx --yes wrangler@4.154.0"
LOG="../private/gifts.csv"
ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # same as the licence service: no 0/O/1/I/L
TOKEN_RX="oauth_token|refresh_token|api_token|authorization|bearer|token"   # what counts as a login left behind (matched without regard to case)

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
  if ! out=$($W kv key put --binding LICENCES --remote "$1" "$2" 2>&1); then
    echo "$out" | tail -5
    if echo "$out" | grep -q "10000"; then
      die "Cloudflare login has expired. Close any Claude Code session first, then run:  npx wrangler@4.154.0 logout && npx wrangler@4.154.0 login   and try again. Finish with:  bash gift.sh --signout"
    fi
    die "Could not save the key. Nothing was created."
  fi
}

case "${1:-}" in
  ""|-h|--help)
    sed -n '2,14p' "$(basename "$0")" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --signout)
    CC=0; if cc_open; then CC=1; fi   # sign-out always wins: never refuse here, only report (Legal HS-1)
    $W logout >/dev/null 2>&1 || true
    left=0
    for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" "$HOME/.wrangler/config/default.toml" "$HOME/.config/.wrangler/config/default.toml"; do
      if [ -f "$f" ]; then n=$(grep -c -i -E "$TOKEN_RX" "$f" || true); printf "%s: %s token line(s)\n" "$f" "$n"; left=$((left + n)); else printf "%s: absent\n" "$f"; fi
    done
    [ "$CC" -eq 0 ] || printf "\nN2 DEVIATION: a Claude Code session was open during this Cloudflare sitting. Report it to Legal (time only).\n"
    [ "$left" -eq 0 ] || die "Still signed in: $left token line(s) left. Run  npx wrangler@4.154.0 logout  and then  bash gift.sh --signout  again."
    printf "\nSigned out of Cloudflare. No login is left on this Mac.\n"; exit 0 ;;
  --scrub)
    no_cc
    shift
    KEYS=$( { tail -n +2 "$LOG" | cut -d, -f2; printf "%s\n" "$@" | tr '[:lower:]' '[:upper:]'; } | grep -E '^HX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' | sort -u || true)
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
    no_cc
    shift
    KEYS=$( { tail -n +2 "$LOG" | cut -d, -f2; printf "%s\n" "$@" | tr '[:lower:]' '[:upper:]'; } | grep -E '^HX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' | sort -u || true)
    [ -n "$KEYS" ] || die "No gift keys found to check."
    bad=0
    for KEY in $KEYS; do
      V=$($W kv key get --binding LICENCES --remote "$KEY" 2>/dev/null || true)
      R=$(printf "%s" "$V" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const m=t.match(/\{[^{}]*\}/);let o;try{o=JSON.parse(m[0])}catch(e){console.log("NOT READ");return}const extra=Object.keys(o).filter(k=>!["session","created","revoked"].includes(k)).length;console.log((o.session==="gift"&&extra===0?"OK  ":"FIX ")+" session is gift: "+(o.session==="gift"?"yes":"NO")+" · extra fields: "+(extra?"YES":"no")+" · switched off: "+(o.revoked===true?"yes":"no"))})' 2>/dev/null || echo "NOT READ")
      case "$R" in OK*) ;; *) bad=$((bad + 1)) ;; esac
      printf "%s  %s\n" "$(mask "$KEY")" "$R"
    done
    [ "$bad" -eq 0 ] || die "$bad key(s) need attention. Run  bash gift.sh --scrub  and check again."
    printf "\nAll gift keys are stored without names.\nNow sign out:  bash gift.sh --signout\n"; exit 0 ;;
  --list)
    column -s, -t < "$LOG" 2>/dev/null || cat "$LOG"; exit 0 ;;
  --revoke)
    no_cc
    KEY=$(printf "%s" "${2:-}" | tr '[:lower:]' '[:upper:]')
    [[ "$KEY" =~ ^HX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$ ]] || die "That doesn't look like a HANDOVER key."
    WHO=$(grep ",$KEY," "$LOG" | head -1 | cut -d, -f3 || true)
    put "$KEY" "{\"session\":\"gift\",\"created\":\"$(date +%F)\",\"revoked\":true}"
    echo "$(date +%F),$KEY,${WHO:-unknown},revoked" >> "$LOG"
    printf "\nRevoked %s%s. It no longer unlocks HANDOVER.\n" "$KEY" "${WHO:+ ($WHO)}"; exit 0 ;;
esac

WHO=$(printf "%s" "$*" | sed 's/,/ ·/g' | tr -d '"\\' | tr -s ' ')   # commas and quotes would break the record
[ -n "$WHO" ] || die "Say who the key is for, e.g.  bash gift.sh \"Maria Lopez, Houston workshop\""
no_cc
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
