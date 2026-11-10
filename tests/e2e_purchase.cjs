// Purchase flow, end to end, with the REAL worker code behind a local HTTP server (Stripe API mocked):
// return page claims a licence -> saved in the browser -> app builds an UNLOCKED pack via /unlock (no dev mode).
// node tests/e2e_purchase.cjs <corpus_dir> <out_dir>
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs"), path = require("path"), os = require("os");
const [corpus, out] = process.argv.slice(2);
const root = path.resolve(__dirname, "..");
(async () => {
  const src = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8").replace(
    'import fragments from "../../private/fragments.json";',
    "const fragments = " + fs.readFileSync(path.join(root, "private/fragments.json"), "utf8") + ";");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hxw-")); fs.writeFileSync(path.join(tmp, "w.mjs"), src);
  const W = await import(path.join(tmp, "w.mjs"));
  const m = new Map();
  const site = 8700 + Math.floor(Math.random() * 200), api = site + 300;
  const env = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec", LICENCE_SECRET: "s3cret", PRICE_ID: "price_1",
    SITE_ORIGIN: `http://127.0.0.1:${site}`, ALLOWED_ORIGINS: `http://127.0.0.1:${site}`, AUTOMATIC_TAX: "false",
    LICENCES: { async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("https://api.stripe.com")) {
      if (String(url).includes("/checkout/sessions/cs_test_PAID")) return new Response(JSON.stringify({ id: "cs_test_PAID", status: "complete", payment_status: "paid", payment_intent: "pi_1", metadata: { product: "handover" } }));
      return new Response("{}");
    }
    return realFetch(url, init);
  };
  const apiSrv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await W.default.fetch(new Request(`http://127.0.0.1:${api}${req.url}`, { method: req.method, headers: req.headers,
      body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(api);
  const srv = spawn("python3", ["-m", "http.server", String(site), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch(); const result = {};
  try {
    const ctx = await b.newContext(devices["iPhone 13"]);
    await ctx.route("**/js/config.js", (route) => route.fulfill({ contentType: "application/javascript",
      body: `window.HANDOVER_CONFIG={API_BASE:"http://127.0.0.1:${api}",STRIPE_PUBLISHABLE_KEY:"pk_test_x",CHECKOUT_PATH:"/checkout/",PRICE_LABEL:"$99 one-time"};` }));
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${site}/checkout/return/?session_id=cs_test_PAID`);
    await p.waitForSelector("#ok:not([hidden])", { timeout: 30000 });
    result.licence = await p.textContent("#key");
    result.urlCleaned = !p.url().includes("session_id");
    await p.screenshot({ path: `${out}/return-mobile.png` });
    await p.goto(`http://127.0.0.1:${site}/app/`);
    await p.waitForFunction(() => window.hxReady, null, { timeout: 120000 });
    await p.setInputFiles("#picker", corpus);
    await p.waitForSelector("#s2:not(.hidden)", { timeout: 120000 });
    await p.click("#buildBtn");
    await p.waitForFunction(() => window.hxPack, null, { timeout: 60000 });
    result.pack = await p.evaluate(() => ({ unlocked: window.hxPack.stats.unlocked, licence: window.hxPack.licence,
      hasPrompt: window.hxPack.parts[0].includes("## Instructions for the AI\n\nYou ") }));
    result.licenceOnRecord = m.has(result.licence);
    // a forged key must not unlock
    await p.evaluate(() => localStorage.setItem("hx_licence", "HX-AAAA-BBBB-CCCC"));
    await p.reload(); await p.waitForFunction(() => window.hxReady, null, { timeout: 120000 });
    await p.setInputFiles("#picker", corpus); await p.waitForSelector("#s2:not(.hidden)");
    await p.click("#buildBtn"); await p.waitForFunction(() => window.hxPack, null, { timeout: 60000 });
    result.forged = await p.evaluate(() => ({ unlocked: window.hxPack.stats.unlocked, msg: document.querySelector("#licenceStatus").textContent }));
    const c2 = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage();
    await p2.goto(`http://127.0.0.1:${site}/checkout/`); await p2.waitForTimeout(800);
    result.checkoutClosedMsg = await p2.textContent("#coStatus");
    await p2.screenshot({ path: `${out}/checkout-desktop.png` });
    result.errors = errs;
  } finally { await b.close(); srv.kill(); apiSrv.close(); }
  console.log(JSON.stringify(result, null, 1));
})();
