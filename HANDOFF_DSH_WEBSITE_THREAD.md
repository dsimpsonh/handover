# HANDOVER → DSH website thread: handoff brief

From: HANDOVER tech thread (Cowork) · 10 Nov 2026 · drop r8 (Cloudflare sign-out check)
Code: `/Users/dian/Sites/handover/` · repo `github.com/dsimpsonh/handover` · live at handover.dianasimpsonhernandez.com
Owner: DiSH Creative Ltd · product by Diana Simpson Hernandez

## ▶ r8 — push this now (11 Nov 2026)

Legal & Compliance rule of 11 Nov 2026 on Cloudflare sign-ins. No page changes.

- `worker/gift.sh`: gift keys no longer store the person's name in Cloudflare (marker `gift` only; names stay in `private/gifts.csv`); `--scrub` rewrites existing gift keys the same way; `--signout` always signs out and reports if a Claude Code session was open.
- `worker/gift.sh`: new `bash gift.sh --signout` (signs out of Cloudflare, then reads back that no Wrangler `default.toml` holds a token line); every key it prints now ends with a reminder to sign out.
- `worker/deploy.sh`: signs out of Cloudflare whenever it ends (finished, failed or interrupted) and will not start while a Claude Code session is open.
- `worker/README.md`: Cloudflare sign-in rules.

```bash
cd ~/Sites/handover && shasum -a 256 -c MANIFEST.sha256 | grep -c ': OK$'   # expect 45
git add worker/gift.sh worker/deploy.sh worker/README.md HANDOFF_DSH_WEBSITE_THREAD.md MANIFEST.sha256
git commit -m "HANDOVER r8: Cloudflare sign-out check for gift licences and deploys"
git push
```

## ✓ r7 — pushed

No page changes visitors will see. Nothing for Diana to run except the one-off standby setup below.

- `worker/gift.sh` (new): Diana's gift-licence tool (`bash gift.sh "Name, Event"`). Its log lives in `private/`, which is git-ignored and never published.
- `worker/README.md`: Gift licences section.
- `_headers` (new): response headers for the Cloudflare Pages standby (security headers; one-week cache for the 14 MB Python runtime). GitHub Pages ignores it.

```bash
cd ~/Sites/handover && shasum -a 256 -c MANIFEST.sha256 | grep -c ': OK$'   # expect 45
git status --short --ignored | grep private                                 # must show !! (ignored)
git add worker/gift.sh worker/README.md _headers HANDOFF_DSH_WEBSITE_THREAD.md MANIFEST.sha256
git commit -m "HANDOVER r7: gift licence tool, Cloudflare Pages standby headers"
git push
```

## Hosting: GitHub Pages now, Cloudflare Pages on standby

Decided 10 Nov 2026: stay on GitHub Pages; keep a Cloudflare Pages copy built from the same repo, not on the domain. **Switch when any one happens:** paid ads start · ~100 sales or ~2,000 app opens a month · any email from GitHub about Pages · a post takes off.

**One-off setup (Diana, ~5 min, dash.cloudflare.com, DiSH Creative account):**
1. Workers & Pages → Create → Pages → Connect to Git → authorise GitHub for `dsimpsonh/handover` only.
2. Project name `handover-site` · production branch `main` · framework **None** · build command **empty** · output directory `/`.
3. Save and deploy. Check `https://handover-site.pages.dev/` loads and `/app/` scans a folder. (Unlock and checkout only work on the real domain; that is expected.)
From then on every `git push` updates both hosts.

**The switch (~10 min):**
1. Pages project → Custom domains → add `handover.dianasimpsonhernandez.com`.
2. At the DNS provider for dianasimpsonhernandez.com: change the `handover` CNAME from `dsimpsonh.github.io` to `handover-site.pages.dev`.
3. Wait until Cloudflare shows the domain Active, then test landing, `/app/`, `/checkout/`.
4. GitHub → repo Settings → Pages → remove the custom domain and turn Pages off.
No code, Worker, Stripe or licence changes. Links and QR codes keep working.

## ✓ r6 — pushed 10 Nov 2026 (ce6a3f7)

App only (`/app/`). No landing, checkout, payment or Worker changes, and nothing for Diana to run.

- **Live progress panel** while a folder is processed: a stage title, a ticking checklist (finding files → sorting → reading documents → fingerprinting photos/videos → connecting files and spotting rules and decisions → preparing review), a progress bar, counts and sizes, the file being read now, time left, and Cancel.
- **Large folders:** files are now processed one at a time and only their text is kept, so business-size folders no longer run the tab out of memory. Photos, video and archives are fingerprinted and listed, not read. Tested on 1,866 files / 617 MB; the browser result matches the CLI byte for byte.
- A note under "Choose folder" explains that the browser's own "upload" prompt doesn't mean anything is uploaded.
- Merged with the website thread's `handover.css` fix (974e7d1); your changes are kept.

Changed files: `engine/scan.py` · `js/worker.js` · `js/app.js` · `app/index.html` · `assets/css/handover.css` · `tests/test_scan_stream.py` (new) · `HANDOFF_DSH_WEBSITE_THREAD.md` · `MANIFEST.sha256`

```bash
cd ~/Sites/handover && shasum -a 256 -c MANIFEST.sha256 | grep -c ': OK$'   # expect 43
git add engine/scan.py js/worker.js js/app.js app/index.html assets/css/handover.css tests/test_scan_stream.py HANDOFF_DSH_WEBSITE_THREAD.md MANIFEST.sha256
git commit -m "HANDOVER r6: live progress panel, streaming scan for large folders"
git push
```

After the push, open `/app/`, choose a folder and check the panel appears straight away and the steps tick off.

## ✓ r5 — pushed 10 Nov 2026 (afae2c6)

r4 is live and the payment switches are on (checked from outside: terms tick box required, Stripe Managed Payments active). r5 changes the landing page only. **No payment, checkout or Worker changes and nothing for Diana to run.**

Changed files: `index.html` · `assets/css/demo.css` (new) · `js/demo.js` (new) · `.gitignore` (now ignores `brand/`, marketing source files that don't belong on the site) · `HANDOFF_DSH_WEBSITE_THREAD.md` · `MANIFEST.sha256`

```bash
cd ~/Sites/handover && shasum -a 256 -c MANIFEST.sha256 | grep -c ': OK$'   # expect 43
git status --short --ignored                                                # private/ and brand/ must show as !! (ignored)
git add index.html assets/css/demo.css js/demo.js .gitignore HANDOFF_DSH_WEBSITE_THREAD.md MANIFEST.sha256
git commit -m "HANDOVER r5: landing page for switching AI providers, walkthrough animation, what you get"
git push
```

After the push, check `https://handover.dianasimpsonhernandez.com/`: the hero shows the walkthrough (coral = old way, green = HANDOVER way), and the page has the sections Why switch, Example, What you get, How it works, Privacy, Price.

## ✓ Launch sequence (r4) — done 10 Nov 2026 — do these in order

**1. Website thread:** check `shasum -a 256 -c MANIFEST.sha256` (expect 43 OK), confirm `private/` is git-ignored, push, then tell Diana "pushed".

**2. Diana, only after the push — paste this one line into Terminal:**

```bash
cd ~/Sites/handover/worker && sed -i '' -e 's/^MANAGED_PAYMENTS = "false"/MANAGED_PAYMENTS = "true"/' -e 's/^REQUIRE_TERMS = "false"/REQUIRE_TERMS = "true"/' wrangler.toml && grep -E '^(MANAGED_PAYMENTS|REQUIRE_TERMS)' wrangler.toml && npx wrangler@4 deploy
```

It should print `MANAGED_PAYMENTS = "true"` and `REQUIRE_TERMS = "true"`, then `Deployed handover-api`. This switches on Stripe as merchant of record and the required terms tick box. Running it before the push would block sales, because the live checkout page wouldn't have the tick box yet.

**3. Diana — one real test purchase** at `https://handover.dianasimpsonhernandez.com/checkout/`: tick the box → Stripe page says "Sold through Onelink" → pay $99 → a key appears on the thank-you page → the app unlocks. Refund it in Stripe, then ask the tech thread for the one-line command to revoke that key.

## Who does what
| This tech thread builds | The DSH website thread does |
|---|---|
| Engine, app, pack builder, prompt, unlock service, Stripe wiring, proof test, legal page drafts | Repo, push, GitHub Pages, DNS, site integration, publishing |

Rule: the website thread **does not edit** `engine/`, `js/worker.js`, `js/app.js` or `private/`. Changes there come from this thread as a new numbered drop with a sha256 manifest.

## What HANDOVER is
A static site. It runs entirely in the browser: Pyodide is self-hosted and nothing is uploaded. The landing page is `/`, the app is `/app/`, and it uses the live DSH design system copied from `frameworks/styles/main.css`.

## Tasks for the website thread
1. **Repo.** Create `dsimpsonh/handover` (public, so GitHub Pages works). Commit everything **except `private/`**, which `.gitignore` already covers. Before pushing, run `git status --ignored` and confirm `private/fragments.json` is listed as ignored.
2. **Pages.** Settings → Pages → deploy from `main` / root. `CNAME` already contains `handover.dianasimpsonhernandez.com`.
3. **DNS.** At the domain provider, add CNAME `handover` → `dsimpsonh.github.io`. Then set the custom domain in Pages and enforce HTTPS.
4. **Main site.** Add a link to HANDOVER in the dianasimpsonhernandez.com navigation or footer, wherever products sit.
5. **Frameworks gallery.** Add a card to `~/Sites/frameworks/data/frameworks.json` with `url`: `https://handover.dianasimpsonhernandez.com/`, category `Tool`, status `Live`.
6. **Visual check against the main site.** Change type, colour and spacing only in `assets/css/handover.css`. Keep `main.css` identical to the frameworks copy.

## Acceptance checks after going live
- `https://handover.dianasimpsonhernandez.com/` and `/app/` load over HTTPS with no console errors.
- The DevTools Network tab shows no third-party requests on `/` and `/app/`. The only exception is `/checkout/`, which loads `js.stripe.com`; Stripe requires this.
- `/vendor/pyodide/pyodide.asm.wasm` is served with content type `application/wasm`.
- `/private/fragments.json` returns **404** in production.
- In the app, choosing a small folder reaches step 03, and the preview shows "Instructions are added when you unlock".
- At phone width (390 px) there is no horizontal scroll.

## Manifest
The current drop's full sha256 list is in `MANIFEST.sha256`, in the repo root. Check it with `shasum -a 256 -c MANIFEST.sha256`.

## Not for the website thread
`worker/` is a Cloudflare Worker for payments and licences. Diana deploys it with `wrangler` (see `worker/README.md`). GitHub Pages serves it only as inert files, and it contains no secrets.

## Coming from this thread later
- `js/config.js` with `API_BASE` and `STRIPE_PUBLISHABLE_KEY` set, after the Worker is deployed. That is a one-file drop, after which the website thread pushes.
- `/terms/` and `/privacy/` pages, plus the restored Legal links in the footer.
- The proof-test number for the landing page.

## r3 — 10 Nov 2026: payment service live, ready to push
- Licence service live at `https://handover-api.dish-creative.workers.dev` (DiSH Creative Cloudflare account; version 48c46b1e). Stripe restricted key + webhook secret stored as Worker secrets.
- `js/config.js` now has `API_BASE` and the live `STRIPE_PUBLISHABLE_KEY` — the one-file drop in the list above is DONE. **The website thread can push now.**
- Verified from outside: health OK · unsigned webhook refused (400) · live checkout session created (200) · unpaid session refused (402) · unknown session 404 · forged licence refused (403).
- `MANIFEST.sha256` covers every shipped file; run `shasum -a 256 -c MANIFEST.sha256` before pushing (expect 39 OK).
- After the site is live: Diana runs one real $99 purchase, checks a key appears and the app unlocks, then refunds it and revokes the key (`worker/README.md` → Support).

## r4 — 10 Nov 2026: terms of sale, Stripe as merchant of record, one way to buy
- New page `terms/` (terms of sale). Footers, checkout and the thank-you page link to it; `privacy/` is complete (contact email filled).
- `/checkout/` now has a required tick box (terms + 14-day waiver). After ticking, the buyer goes to Stripe's hosted checkout with **Managed Payments** (Stripe/Onelink is merchant of record and handles VAT and sales tax worldwide), then comes back to `/checkout/return/`.
- **One way to buy:** link every "Buy" button, email and social post to `https://handover.dianasimpsonhernandez.com/checkout/`. Do **not** use the old Stripe Payment Link, buy button or `brand/handover_payment_qr.png`; they are retired. Use `brand/handover_checkout_qr.png` / `.svg` for print and slides.
- Landing page repositioned for **switching AI providers**: new hero headline, a "Why switch" section (#why) and a worked example "Two years on Claude. Moving on." (#example). A "What you get" section (#get) names the three files: HANDOVER_PACK.md, KNOWLEDGE_BLUEPRINT.md and the standing instructions file. The walkthrough shows the old way in coral and the HANDOVER way in green. The hero also has a one-minute captioned walkthrough animation (`assets/css/demo.css`, `js/demo.js`, markup in `index.html`). No video file, no third parties; it plays only when visible, has pause/replay, and respects reduced-motion settings.
- Push and launch: follow **▶ Launch sequence (r4)** at the top of this brief.

