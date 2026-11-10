# HANDOVER → DSH website thread: handoff brief

From: HANDOVER tech thread (Cowork) · 10 Nov 2026 · drop r4 (terms + Stripe as merchant of record; one way to buy — ready to push)
Code: `/Users/dian/Sites/handover/` (local only; no git repo yet)
Owner: DiSH Creative Ltd · product by Diana Simpson Hernandez

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
- Push this drop, then tell Diana. **Only after the push** she runs (one line, Terminal):
  `cd ~/Sites/handover/worker && sed -i '' -e 's/^MANAGED_PAYMENTS = "false"/MANAGED_PAYMENTS = "true"/' -e 's/^REQUIRE_TERMS = "false"/REQUIRE_TERMS = "true"/' wrangler.toml && npx wrangler@4 deploy`
- Then one real $99 purchase: the Stripe page should say "Sold through Onelink", a key appears on the thank-you page, the app unlocks. Refund it in Stripe.

