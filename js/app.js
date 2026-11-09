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
  const worker = new Worker("/js/worker.js");
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.cmd === "progress") return onProgress(m);
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  };
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
  function onProgress(m) {
    $("#prog").classList.remove("hidden");
    const pct = m.phase === "read" ? Math.min(90, Math.round(90 * m.done / Math.max(1, m.total))) : 95;
    $("#prog i").style.width = pct + "%";
    setStatus(m.phase === "read" ? `Reading ${m.done.toLocaleString()} of ${m.total.toLocaleString()} files…`
                                 : `Mapping ${m.total.toLocaleString()} files…`);
  }

  // ---- unlock -----------------------------------------------------------------------------------------------
  async function loadFragments() {
    const dev = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("dev");
    if (dev) {
      const r = await fetch("/private/fragments.json");
      if (r.ok) { S.licence = S.licence || "HX-DEV"; return r.text(); }
    }
    if (!C.UNLOCK_URL || !S.licence) return null;
    const r = await fetch(C.UNLOCK_URL, { method: "POST", headers: { "content-type": "application/json" },
                                          body: JSON.stringify({ licence: S.licence }) });
    if (!r.ok) throw new Error(r.status === 403 ? "That licence key was not recognised." : "Unlock service unavailable.");
    return r.text();
  }

  // ---- 1. choose ----------------------------------------------------------------------------------------------
  rpc("init").then(() => {
    $("#engineState").textContent = "Ready. Nothing is uploaded.";
    $("#pickBtn").removeAttribute("aria-disabled");
    $("#picker").disabled = false;
    window.hxReady = true;
  }).catch((e) => { $("#engineState").textContent = "The engine could not load: " + e.message; });

  async function runScan(entries) {
    if (!entries.length) return;
    setStatus("Starting…");
    try {
      const r = await rpc("scan", { entries });
      window.hxScan = { sha256: r.sha256, files: r.files, readMs: r.readMs, scanMs: r.scanMs };
      $("#prog i").style.width = "100%";
      S.graph = JSON.parse(r.graph);
      S.review = JSON.parse(await rpc("review"));
      renderReview();
      step(2);
    } catch (e) { setStatus("Something went wrong: " + e.message); }
  }
  $("#picker").addEventListener("change", (ev) =>
    runScan([...ev.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (!window.hxReady) return;
    const entries = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        entries.push({ path: prefix + entry.name, file });
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
    if (C.STRIPE_LINK) { buy.href = C.STRIPE_LINK; buy.removeAttribute("aria-disabled"); }
    else { buy.removeAttribute("href"); buy.setAttribute("aria-disabled", "true"); buy.style.opacity = 0.6; buy.title = "Checkout opens soon"; }
  }
  $("#licenceBtn").onclick = () => {
    const v = $("#licence").value.trim().toUpperCase();
    if (!/^HX-[A-Z0-9-]{4,}$/.test(v)) { $("#licenceStatus").textContent = "That doesn't look like a licence key."; return; }
    S.licence = v; store.set("hx_licence", v);
    build();
  };
})();
