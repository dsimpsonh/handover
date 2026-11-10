#!/usr/bin/env bash
# HANDOVER gift licences: free keys for family, friends, workshop places. No Stripe, no checkout.
#
#   bash gift.sh "Maria Lopez, Houston workshop"   create a key for this person and print it
#   bash gift.sh --list                            show every gift key you have made
#   bash gift.sh --revoke HX-ABCD-EFGH-JKMN        switch a key off (it stops unlocking)
#
# Keys are stored in the live licence store (Cloudflare KV, DiSH Creative account).
# A record of each gift is kept on this Mac in ../private/gifts.csv (never published: private/ is git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
W="npx --yes wrangler@4"
LOG="../private/gifts.csv"
ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # same as the licence service: no 0/O/1/I/L

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
      die "Cloudflare login has expired. Run:  npx wrangler@4 logout && npx wrangler@4 login   then try again."
    fi
    die "Could not save the key. Nothing was created."
  fi
}

case "${1:-}" in
  ""|-h|--help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --list)
    column -s, -t < "$LOG" 2>/dev/null || cat "$LOG"; exit 0 ;;
  --revoke)
    KEY=$(printf "%s" "${2:-}" | tr '[:lower:]' '[:upper:]')
    [[ "$KEY" =~ ^HX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$ ]] || die "That doesn't look like a HANDOVER key."
    WHO=$(grep ",$KEY," "$LOG" | head -1 | cut -d, -f3 || true)
    put "$KEY" "{\"session\":\"gift:${WHO:-unknown}\",\"created\":\"$(date +%F)\",\"revoked\":true}"
    echo "$(date +%F),$KEY,${WHO:-unknown},revoked" >> "$LOG"
    printf "\nRevoked %s%s. It no longer unlocks HANDOVER.\n" "$KEY" "${WHO:+ ($WHO)}"; exit 0 ;;
esac

WHO=$(printf "%s" "$*" | sed 's/,/ ·/g' | tr -d '"\\' | tr -s ' ')   # commas and quotes would break the record
[ -n "$WHO" ] || die "Say who the key is for, e.g.  bash gift.sh \"Maria Lopez, Houston workshop\""
KEY="HX-$(group)-$(group)-$(group)"
put "$KEY" "{\"session\":\"gift:$WHO\",\"created\":\"$(date +%F)\",\"revoked\":false}"
echo "$(date +%F),$KEY,$WHO,active" >> "$LOG"

cat <<EOF

  Gift licence for $WHO:

      $KEY

  Send them:
      1. Open https://handover.dianasimpsonhernandez.com/app/
      2. Choose a folder, then paste the key into the unlock box.

  Recorded in private/gifts.csv. To switch it off later:  bash gift.sh --revoke $KEY

EOF
