// End-to-end: node tests/e2e.cjs <corpus_dir> <expected_cli_sha> <out_dir>
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const [corpus, cliSha, out] = process.argv.slice(2);
(async () => {
  const port = 8600 + Math.floor(Math.random() * 300);
  const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: path.resolve(__dirname, ".."), stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch();
  const res = {};
  try {
    for (const [name, url, ctxOpts] of [["unlocked-desktop", "/app/?dev=1", { viewport: { width: 1280, height: 900 } }],
                                         ["locked-mobile", "/app/", devices["iPhone 13"]]]) {
      const ctx = await b.newContext(ctxOpts);
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      await p.goto(`http://127.0.0.1:${port}${url}`);
      await p.waitForFunction(() => window.hxReady, null, { timeout: 120000 });
      await p.setInputFiles("#picker", corpus);
      await p.waitForSelector("#s2:not(.hidden)", { timeout: 300000 });
      const scanInfo = await p.evaluate(() => window.hxScan);
      await p.click('details.sec[data-sec="rules"] summary');
      await p.fill("#terms", "Ana Ruiz");
      await p.screenshot({ path: `${out}/${name}-review.png`, fullPage: false });
      await p.click("#buildBtn");
      await p.waitForFunction(() => window.hxPack, null, { timeout: 120000 });
      const pk = await p.evaluate(() => ({ stats: window.hxPack.stats, head: window.hxPack.parts[0].slice(0, 400),
        hasPrompt: window.hxPack.parts[0].includes("Instructions for the AI\n\nYou are"), anaLeft: window.hxPack.parts.join("").includes("Ana Ruiz") }));
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${out}/${name}-pack.png`, fullPage: false });
      res[name] = { scan: scanInfo, parity: scanInfo.sha256 === cliSha, pack: pk, overflow, errors: errs };
      await ctx.close();
    }
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.screenshot({ path: `${out}/landing-desktop.png` });
    const m = await b.newContext(devices["iPhone 13"]); const mp = await m.newPage();
    await mp.goto(`http://127.0.0.1:${port}/`);
    res.landingOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await mp.screenshot({ path: `${out}/landing-mobile.png` });
  } finally { await b.close(); srv.kill(); }
  console.log(JSON.stringify(res, null, 1));
})();
