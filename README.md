# HANDOVER

**Never lose your AI's memory when you switch models.**
A DiSH Creative Ltd product by Diana Simpson Hernandez · `handover.dianasimpsonhernandez.com`

HANDOVER maps a folder **inside the user's browser** and builds one paste-ready pack for the AI they are moving to. That AI writes the `KNOWLEDGE_BLUEPRINT.md` and a standing instructions file (`CLAUDE.md`, `AGENTS.md`, …). No document is ever uploaded to us.

## How it is built

```
index.html              landing page
app/index.html          the app: 01 Choose → 02 Review → 03 Pack
js/app.js               UI controller (no network calls except the optional unlock service)
js/worker.js            Web Worker: runs Pyodide + the Python engine off the UI thread
js/config.js            public settings: API_BASE, STRIPE_PUBLISHABLE_KEY (no secrets)
js/checkout.js, js/return.js   embedded Stripe checkout (ui_mode=form) and licence claim
checkout/, checkout/return/    checkout pages (the ONLY pages that load a third-party script: js.stripe.com)
worker/                 Cloudflare Worker: checkout session, licence issue/claim, webhook, unlock (see worker/README.md)
engine/scan.py          layer 1: folder -> graph.json (stdlib; identical output in CLI and browser)
engine/pack.py          layer 2: graph -> ranked, redacted, budgeted pack + licensed prompt
engine/render.py        interactive map
engine/default_config.json   ~45 common business tools detected as external systems
vendor/pyodide/         self-hosted Pyodide 0.26.4 (Apache-2.0) — no CDNs
assets/                 DSH design system (copied from frameworks/styles/main.css) + self-hosted fonts
private/fragments.json  PROMPT FRAGMENTS — gitignored, never published (see Protection)
tests/                  unit tests (python) + end-to-end browser test (playwright)
```

Privacy by construction: the pack is built only from the graph, and the graph only holds bounded excerpts (headings, first lines, rule/decision lines, link evidence). Email addresses and phone numbers are blanked by default; users can untick items, leave out folders and blank out terms.

## Protection of the prompt
1. **The value is in the engine.** Scanning, ranking, budgeting and pack structure are code; the prompt is a thin instruction.
2. **Assembled per folder.** The prompt is built from fragments chosen by the folder's own features, so no two packs carry the same prompt.
3. **Delivered after payment.** `private/fragments.json` is never shipped in the public site. Free users get the map and a preview; the unlock service returns the fragments for a valid licence.
4. **Watermarked.** Variant choices encode the licence ID; `pack.trace_licence()` identifies the licence behind a leaked pack.
5. **Terms of sale** (to be drafted): personal or internal use, no redistribution, keep confidential.

## Run locally
```bash
cd ~/Sites/handover
python3 -m http.server 8000
# free mode:     http://localhost:8000/app/
# unlocked dev:  http://localhost:8000/app/?dev=1   (reads private/fragments.json, localhost only)
python3 -m unittest discover -s tests
python3 engine/scan.py <folder> -o graph.json --config engine/default_config.json   # CLI, same graph as the browser
```

## Deploy (GitHub Pages, custom subdomain)
1. `git init -b main && git add . && git commit -m "HANDOVER v0.1"` (private/ is ignored).
2. Create the repo `dsimpsonh/handover` and push. Settings → Pages → Deploy from branch `main` / root.
3. DNS at your domain provider: **CNAME** `handover` → `dsimpsonh.github.io`.
4. Pages → Custom domain `handover.dianasimpsonhernandez.com` → tick *Enforce HTTPS* once the certificate is issued.

## Not built yet (in order)
- Deploy the worker and set `API_BASE` + `STRIPE_PUBLISHABLE_KEY` (worker/README.md).
- Terms of sale + privacy notice pages, then restore the Legal links in the footer.
- Proof test: a fresh AI with vs without the pack, scored on 30 questions — the landing-page number.
- A card in the frameworks gallery (`frameworks/data/frameworks.json`).
