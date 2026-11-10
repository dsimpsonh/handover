/* HANDOVER — app controller. All work happens in js/worker.js inside this tab. */
"use strict";
(() => {
  const C = window.HANDOVER_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: ignore */ } },
  };

  // ---- worker RPC -------------------------------------------------------------------------------------------
  let worker = null;
  let seq = 0;
  const waiting = new Map();
  const onWorkerMessage = (ev) => {
    const m = ev.data;
    if (m.cmd === "progress") return onProgress(m);
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  };
  function startWorker() {
    worker = new Worker("/js/worker.js");
    worker.onmessage = onWorkerMessage;
    return rpc("init");
  }
  const rpc = (cmd, data = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, ...data });
  });

  // ---- state ------------------------------------------------------------------------------------------------
  const S = { review: null, excluded: new Set(), exFolders: new Set(), fragments: null, licence: store.get("hx_licence") };
  window.hx = S;   // test hook

  function step(n) {
    document.querySelectorAll("#stepper span").forEach((s) => {
      const k = +s.dataset.s;
      s.className = k < n ? "done" : k === n ? "on" : "";
    });
    $("#s1").classList.toggle("hidden", n !== 1);
    $("#s2").classList.toggle("hidden", n < 2);
    $("#s3").classList.toggle("hidden", n < 3);
  }
  const setStatus = (t) => { $("#status").textContent = t; };

  // ---- progress panel ---------------------------------------------------------------------------------------
  const ORDER = ["find", "sort", "read", "hash", "map", "review"];
  const TITLES = { find: "Finding your files…", sort: "Sorting what to read…", read: "Reading your documents…",
    hash: "Fingerprinting photos, videos and other files…", map: "Connecting the dots…", review: "Preparing your review…" };
  const MAP_SUBS = ["Following links between files", "Spotting rules", "Spotting decisions and the reasons behind them",
    "Matching skills and instructions to the documents they use", "Checking which documents look superseded", "Building your map"];
  const R = { stage: null, t0: 0, plan: null, subTimer: null, elapsed: null };
  const n = (x) => Number(x || 0).toLocaleString();
  const mb = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? Math.round(b / 1e6) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
  const eta = (ms) => ms == null ? "Working out time left…" : ms < 45e3 ? "Less than a minute left"
    : ms < 90e3 ? "About a minute left" : `About ${Math.round(ms / 6e4)} minutes left`;
  function runStage(k) {
    if (R.stage === k) return;
    R.stage = k;
    const i = ORDER.indexOf(k);
    document.querySelectorAll("#runSteps li").forEach((li) => {
      const j = ORDER.indexOf(li.dataset.k);
      if (j < i && !li.classList.contains("skip")) li.className = "done";
      else if (j === i) li.className = "on";
      else if (!li.classList.contains("skip")) li.className = "";
      const sub = li.querySelector(".sub"); if (sub && j !== i) sub.remove();
    });
    $("#runTitle").textContent = TITLES[k];
    $("#runFile").textContent = "";
    clearInterval(R.subTimer);
    const busy = k === "find" || k === "sort" || k === "map" || k === "review";
    $("#runBar").parentElement.classList.toggle("busy", busy);
    if (k === "map") {       // one engine call: show what it is doing, in turn
      let s = 0;
      const li = document.querySelector('#runSteps li[data-k="map"]');
      const sub = document.createElement("span"); sub.className = "sub"; li.appendChild(sub);
      const show = () => { sub.textContent = MAP_SUBS[s % MAP_SUBS.length] + "…"; s++; };
      show(); R.subTimer = setInterval(show, 1600);
      $("#runCount").innerHTML = `<b>${n(R.plan && R.plan.docs)}</b> documents read · <b>${n(R.plan && R.plan.others)}</b> other files listed`;
      $("#runEta").textContent = "Almost there";
    }
  }
  function runOpen() {
    $("#run").classList.remove("hidden"); $("#drop").classList.add("hidden"); setStatus("");
    document.querySelectorAll("#runSteps li").forEach((li) => { li.className = ""; const s = li.querySelector(".sub"); if (s) s.remove(); });
    R.stage = null; R.plan = null; R.t0 = performance.now();
    $("#runBar").style.width = "0"; $("#runCount").textContent = ""; $("#runEta").textContent = "";
    $("#runNote").textContent = "Everything stays in this tab. Keep it open until this finishes.";
  }
  function runClose() { clearInterval(R.subTimer); $("#run").classList.add("hidden"); $("#drop").classList.remove("hidden"); }
  function onProgress(m) {
    if (m.stage === "find") {
      runStage("find");
      $("#runCount").innerHTML = `<b>${n(m.found)}</b> files found so far`;
      return;
    }
    if (m.stage === "sort") {
      runStage("sort");
      R.plan = m;
      $("#runCount").innerHTML = `<b>${n(m.docs)}</b> documents to read (${mb(m.docBytes)}) · <b>${n(m.others)}</b> other files to list (${mb(m.otherBytes)})`;
      if (!m.docs) document.querySelector('#runSteps li[data-k="read"]').className = "skip";
      if (!m.others) document.querySelector('#runSteps li[data-k="hash"]').className = "skip";
      if (m.docs > 3000 || m.docBytes > 2e9 || m.otherBytes > 20e9)
        $("#runNote").textContent = "That's a big folder, so this can take a while. Keep this tab open; you can carry on working in other tabs.";
      return;
    }
    if (m.stage === "read" || m.stage === "hash") {
      runStage(m.stage);
      const pct = m.bytesTotal ? m.bytesDone / m.bytesTotal : m.done / Math.max(1, m.total);
      $("#runBar").style.width = Math.max(2, Math.round(100 * pct)) + "%";
      $("#runCount").innerHTML = m.stage === "read"
        ? `<b>${n(m.done)}</b> of <b>${n(m.total)}</b> documents · ${mb(m.bytesDone)} of ${mb(m.bytesTotal)}`
        : `<b>${n(m.done)}</b> of <b>${n(m.total)}</b> other files · ${mb(m.bytesDone)} of ${mb(m.bytesTotal)}`;
      $("#runEta").textContent = eta(m.etaMs);
      $("#runFile").textContent = m.file ? (m.stage === "read" ? "Reading " : "Listing ") + m.file : "";
      return;
    }
    if (m.stage === "map") {
      runStage("map");
      if (m.done != null) {
        $("#runBar").parentElement.classList.remove("busy");
        $("#runBar").style.width = Math.max(2, Math.round(100 * (m.frac != null ? m.frac : m.done / Math.max(1, m.total)))) + "%";
        $("#runCount").innerHTML = `Spotting rules and decisions in <b>${n(m.done)}</b> of <b>${n(m.total)}</b> files`;
        $("#runEta").textContent = eta(m.etaMs);
        $("#runFile").textContent = m.file ? "Checking " + m.file : "";
      }
    }
  }

  // ---- unlock -----------------------------------------------------------------------------------------------
  async function loadFragments() {
    const dev = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("dev");
    if (dev) {
      const r = await fetch("/private/fragments.json");
      if (r.ok) { S.licence = S.licence || "HX-DEV"; return r.text(); }
    }
    if (!C.API_BASE || !S.licence) return null;
    const r = await fetch(C.API_BASE.replace(/\/$/, "") + "/unlock", { method: "POST", headers: { "content-type": "application/json" },
                                          body: JSON.stringify({ licence: S.licence }) });
    if (!r.ok) throw new Error(r.status === 403 ? "That licence key was not recognised." : "Unlock service unavailable.");
    return r.text();
  }

  // ---- 1. choose ----------------------------------------------------------------------------------------------
  startWorker().then(() => {
    $("#engineState").textContent = "Ready. Nothing is uploaded.";
    $("#pickBtn").removeAttribute("aria-disabled");
    $("#picker").disabled = false;
    window.hxReady = true;
  }).catch((e) => { $("#engineState").textContent = "The engine could not load: " + e.message; });

  let cancelled = false;
  async function runScan(entries) {
    if (!entries.length) { runClose(); setStatus("That folder looks empty."); return; }
    cancelled = false;
    runStage("find"); $("#runCount").innerHTML = `<b>${n(entries.length)}</b> files found`;
    try {
      const r = await rpc("scan", { entries });
      window.hxScan = { sha256: r.sha256, files: r.files, readMs: r.readMs, scanMs: r.scanMs };
      runStage("review");
      S.graph = JSON.parse(r.graph);
      S.review = JSON.parse(await rpc("review"));
      document.querySelectorAll("#runSteps li").forEach((li) => { if (!li.classList.contains("skip")) li.className = "done"; });
      $("#runBar").parentElement.classList.remove("busy"); $("#runBar").style.width = "100%";
      const secs = Math.round((performance.now() - R.t0) / 1000);
      $("#runTitle").textContent = `Done in ${secs < 90 ? secs + " seconds" : Math.round(secs / 60) + " minutes"}.`;
      renderReview();
      step(2);
      setTimeout(runClose, 400);
    } catch (e) {
      if (cancelled) return;
      runClose(); setStatus("Something went wrong: " + e.message);
    }
  }
  $("#cancelBtn").addEventListener("click", () => {
    cancelled = true;
    worker.terminate();
    waiting.forEach((p) => p.reject(new Error("cancelled"))); waiting.clear();
    runClose(); setStatus("Stopped. Nothing was kept. Choose a folder to start again.");
    $("#engineState").textContent = "Restarting the engine…"; $("#picker").disabled = true; window.hxReady = false;
    startWorker().then(() => { $("#engineState").textContent = "Ready. Nothing is uploaded."; $("#picker").disabled = false; window.hxReady = true; });
  });
  $("#picker").addEventListener("change", (ev) => {
    runOpen();
    const entries = [...ev.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
    ev.target.value = "";
    runScan(entries);
  });
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (!window.hxReady) return;
    runOpen(); runStage("find");
    const entries = [];
    let lastPing = 0;
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        entries.push({ path: prefix + entry.name, file });
        const now = performance.now();
        if (now - lastPing > 150) { lastPing = now; onProgress({ stage: "find", found: entries.length }); }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const ch of batch) await walk(ch, prefix + entry.name + "/");
        } while (batch.length);
      }
    };
    for (const it of e.dataTransfer.items) { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) await walk(en, ""); }
    runScan(entries);
  });

  // ---- 2. review ----------------------------------------------------------------------------------------------
  function renderReview() {
    const st = S.graph.stats;
    $("#kpis").innerHTML = [["files", st.files], ["read", st.files_mined], ["links", st.edges_by_type.mentions || 0],
      ["rules", st.rule_lines], ["decisions", st.decision_lines], ["folders", (st.nodes_by_kind.folder || 0)]]
      .map(([k, v]) => `<div class="kpi"><b>${Number(v).toLocaleString()}</b><span>${k}</span></div>`).join("");
    $("#folders").innerHTML = S.review.folders.length ? S.review.folders.map((f) =>
      `<label class="chip"><input type="checkbox" data-folder="${esc(f)}"> ${esc(f)}/</label>`).join("")
      : '<span class="hx-note">No sub-folders.</span>';
    $("#folders").onchange = (e) => {
      const f = e.target.dataset.folder;
      e.target.checked ? S.exFolders.add(f) : S.exFolders.delete(f);
    };
    $("#target").innerHTML = Object.entries(S.review.targets).map(([k, t]) =>
      `<option value="${k}">${esc(t.name)} — ${esc(t.file)}</option>`).join("");
    const by = {};
    S.review.items.forEach((it) => (by[it.section] = by[it.section] || []).push(it));
    $("#sections").innerHTML = S.review.sections.filter((s) => by[s.id]).map((s) =>
      `<details class="sec" data-sec="${s.id}"><summary>${esc(s.title)}<span class="n">${by[s.id].length.toLocaleString()} items</span></summary>
       <ul class="items"></ul><button class="more hidden" type="button">Show more</button></details>`).join("");
    document.querySelectorAll("details.sec").forEach((d) => {
      const list = by[d.dataset.sec];
      let shown = 0;
      const ul = d.querySelector("ul"), more = d.querySelector(".more");
      const render = () => {
        const next = list.slice(shown, shown + 60);
        ul.insertAdjacentHTML("beforeend", next.map((it) =>
          `<li><input type="checkbox" data-id="${esc(it.id)}" ${S.excluded.has(it.id) ? "" : "checked"} aria-label="include">
           <div>${esc(it.text)}<small>${esc(it.sources.slice(0, 3).join(" · "))}${it.sources.length > 3 ? " +" + (it.sources.length - 3) : ""}</small></div></li>`).join(""));
        shown += next.length;
        more.classList.toggle("hidden", shown >= list.length);
        more.textContent = `Show more (${(list.length - shown).toLocaleString()} left)`;
      };
      d.addEventListener("toggle", () => { if (d.open && !shown) render(); });
      more.onclick = render;
      ul.onchange = (e) => { const id = e.target.dataset.id; e.target.checked ? S.excluded.delete(id) : S.excluded.add(id); };
    });
  }
  $("#mapBtn").onclick = async () => {
    const f = $("#map");
    if (f.classList.contains("hidden") && !f.srcdoc) f.srcdoc = await rpc("map");
    f.classList.toggle("hidden");
  };

  // ---- 3. pack ------------------------------------------------------------------------------------------------
  function opts() {
    return { target: $("#target").value, mode: $("#mode").value, licence: S.licence || "HX-UNLICENSED",
             exclude: [...S.excluded], exclude_folders: [...S.exFolders],
             redact_terms: $("#terms").value.split("\n").map((s) => s.trim()).filter(Boolean),
             redact_emails: $("#redEmails").checked, redact_phones: $("#redPhones").checked };
  }
  async function build() {
    $("#buildStatus").textContent = "Building…";
    try {
      try { S.fragments = await loadFragments(); } catch (e) { $("#licenceStatus").textContent = e.message; S.fragments = null; }
      const r = JSON.parse(await rpc("build", { fragments: S.fragments || "", opts: opts() }));
      window.hxPack = r;
      renderPack(r);
      step(3);
      $("#buildStatus").textContent = "";
      $("#s3").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { $("#buildStatus").textContent = "Could not build the pack: " + e.message; }
  }
  $("#buildBtn").onclick = build;

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function renderPack(r) {
    const s = r.stats, unlocked = s.unlocked;
    $("#packSummary").innerHTML = `${s.parts} part${s.parts > 1 ? "s" : ""} · about ${s.approx_tokens.toLocaleString()} tokens · ` +
      `${s.items_included.toLocaleString()} of ${s.items_available.toLocaleString()} items` +
      (s.items_dropped ? ` (${s.items_dropped.toLocaleString()} least important left out to fit)` : "") +
      ` · ${s.redactions} blanked out`;
    const PREVIEW = 2400;
    $("#parts").innerHTML = r.parts.map((p, i) => `<div class="part"><div class="row" style="justify-content:space-between">
        <strong>Part ${i + 1} of ${r.parts.length}</strong><span class="hx-note">${p.length.toLocaleString()} characters</span></div>
        <pre>${esc(unlocked ? p : p.slice(0, PREVIEW) + "\n\n… preview ends here. Unlock for the full pack.")}</pre>
        <div class="row"><button class="btn btn-primary" data-copy="${i}" ${unlocked ? "" : "disabled"} type="button">Copy</button>
        <button class="btn" data-dl="${i}" ${unlocked ? "" : "disabled"} type="button">Download</button></div></div>`).join("");
    $("#parts").onclick = async (e) => {
      const c = e.target.closest("[data-copy]"), d = e.target.closest("[data-dl]");
      if (c) { await navigator.clipboard.writeText(r.parts[+c.dataset.copy]); c.textContent = "Copied"; setTimeout(() => (c.textContent = "Copy"), 1500); }
      if (d) download(`HANDOVER_PACK_part${+d.dataset.dl + 1}_of_${r.parts.length}.md`, r.parts[+d.dataset.dl]);
    };
    $("#unlock").classList.toggle("hidden", unlocked);
    $("#next").classList.toggle("hidden", !unlocked);
    $("#price").textContent = C.PRICE_LABEL || "";
    const buy = $("#buyBtn");
    if (C.API_BASE && C.STRIPE_PUBLISHABLE_KEY) { buy.href = C.CHECKOUT_PATH || "/checkout/"; buy.target = "_self"; buy.removeAttribute("aria-disabled"); }
    else { buy.removeAttribute("href"); buy.setAttribute("aria-disabled", "true"); buy.style.opacity = 0.6; buy.title = "Checkout opens soon"; }
  }
  $("#licenceBtn").onclick = () => {
    const v = $("#licence").value.trim().toUpperCase();
    if (!/^HX-[A-Z0-9-]{4,}$/.test(v)) { $("#licenceStatus").textContent = "That doesn't look like a licence key."; return; }
    S.licence = v; store.set("hx_licence", v);
    build();
  };
})();
