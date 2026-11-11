#!/usr/bin/env python3
"""HANDOVER site parity check (HO-8): does a copy of the site serve the same bytes as the live one?

  python3 parity.py <live base URL> <copy base URL> [DIST_MANIFEST.txt]

For every file in the manifest (and the folder address of every index.html) it fetches both sites and compares
HTTP status, byte count and sha256. Prints a table; exits 1 if any row differs. Read-only, no login.
"""
import hashlib, sys, urllib.request, urllib.error, pathlib, datetime

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "handover-parity/1", "Accept-Encoding": "identity", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read(); return r.status, len(b), hashlib.sha256(b).hexdigest()
    except urllib.error.HTTPError as e:
        b = e.read(); return e.code, len(b), hashlib.sha256(b).hexdigest()
    except Exception as e:
        return "ERR:" + type(e).__name__, 0, "-"

def main():
    if len(sys.argv) < 3: print(__doc__); return 2
    live, copy = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
    man = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else pathlib.Path(__file__).with_name("DIST_MANIFEST.txt"))
    want = {}
    for line in man.read_text().splitlines():
        if line.strip():
            h, p = line.split("  ", 1); want[p] = h
    paths = []
    for p in sorted(want):
        if p.startswith("_"): continue                      # _headers is configuration, not a page
        if p.endswith("index.html"): paths.append(("/" + p[:-len("index.html")], want[p]))
        else: paths.append(("/" + p, want[p]))
    bad = 0
    print(f"# Parity: {live}  vs  {copy}\nRun {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%dT%H:%M:%SZ} · manifest {man.name} ({len(want)} files) · {len(paths)} addresses\n")
    print("| Address | Live status | Copy status | Live bytes | Copy bytes | sha256 (live) | Same as copy | Same as commit |\n|---|---|---|---|---|---|---|---|")
    for p, h in paths:
        a, b = get(live + p), get(copy + p)
        same = a == b and a[0] == 200
        commit = (a[2] == h, b[2] == h)
        ok = same and all(commit)
        bad += 0 if ok else 1
        print(f"| {p} | {a[0]} | {b[0]} | {a[1]} | {b[1]} | {a[2][:16]} | {'yes' if same else 'NO'} | {'yes' if all(commit) else 'NO (live %s, copy %s)' % tuple('ok' if c else 'differs' for c in commit)} |")
    miss = get(copy + "/private/fragments.json")[0], get(copy + "/worker/gift.sh")[0], get(copy + "/HANDOFF_DSH_WEBSITE_THREAD.md")[0]
    leak = [s for s in miss if s == 200]
    print(f"\nNon-site addresses on the copy (/private/fragments.json, /worker/gift.sh, /HANDOFF_DSH_WEBSITE_THREAD.md): {miss} — {'none served' if not leak else 'SERVED: FAIL'}")
    bad += len(leak)
    print(f"\n**{'PASS' if bad == 0 else 'FAIL'}: {len(paths) - min(bad, len(paths))} of {len(paths)} addresses identical; {bad} problem(s).**")
    return 0 if bad == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
