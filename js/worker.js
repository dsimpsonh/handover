/* HANDOVER — engine worker.
 * Runs Pyodide (self-hosted under /vendor/pyodide/) and the Python engine (scan.py, pack.py, render.py) off the UI
 * thread. Files are read here, inside this tab. Nothing in this file makes a network request except loading the
 * engine's own files from this site.
 *
 * Messages in:  {id, cmd: "init"} | {id, cmd: "scan", entries:[{path, file}], config} | {id, cmd: "review"}
 *               | {id, cmd: "build", fragments, opts} | {id, cmd: "map"}
 * Messages out: {id, ok, result} | {id, ok:false, error} | {cmd:"progress", stage, ...} (see doScan)
 */
"use strict";
importScripts("/vendor/pyodide/pyodide.js");

let py = null;
let graphText = null;
const ENGINE = ["scan.py", "pack.py", "render.py"];

async function init() {
  if (py) return { ready: true };
  py = await loadPyodide({ indexURL: "/vendor/pyodide/" });
  const srcs = await Promise.all(ENGINE.map((f) => fetch("/engine/" + f).then((r) => {
    if (!r.ok) throw new Error("engine file " + f + " " + r.status);
    return r.text();
  })));
  ENGINE.forEach((f, i) => py.FS.writeFile("/home/pyodide/" + f, srcs[i]));
  py.runPython("import sys, json; sys.path.insert(0, '/home/pyodide'); import scan, pack, render");
  return { ready: true };
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Streams the folder one file at a time: documents are reduced to their text inside the engine (scan.prepare),
// everything else is fingerprinted and listed. Only text is kept, so large business folders fit in memory.
// Progress: {cmd:"progress", stage, done, total, bytesDone, bytesTotal, file, etaMs}
async function doScan(entries, configJson) {
  if (!configJson) configJson = await fetch("/engine/default_config.json").then((r) => r.text());
  const root = entries.length ? entries[0].path.split("/")[0] : "folder";
  py.globals.set("_cfg_in", configJson || "{}");
  py.runPython("_cfg = scan.merge_config(json.loads(_cfg_in)); _files = {}; _readable = scan.TEXT_EXT | scan.HTML_EXT | {'docx', 'pdf'}");
  const cfg = py.globals.get("_cfg").toJs({ dict_converter: Object.fromEntries });
  const isExcluded = py.runPython("lambda rel: scan.is_excluded(rel, _cfg)");
  const extOf = py.globals.get("scan").ext_of;
  const readable = py.runPython("lambda e: e in _readable");
  const prepare = py.runPython("def _prep(rel, buf):\n    _files[rel] = scan.prepare(rel, buf.to_bytes(), _cfg)\n_prep");
  const stub = py.runPython("def _stub(rel, size, sha, listed):\n    _files[rel] = {'size': size, 'sha256': sha, 'pre': (None, 'none', None)} if listed else {'size': size, 'sha256': sha}\n_stub");

  // 1. sort what to read
  const t0 = performance.now();
  const docs = [], others = [];
  let skipped = 0;
  for (const { path, file } of entries) {
    const rel = path.split("/").slice(1).join("/");
    if (!rel || isExcluded(rel)) { skipped++; continue; }
    const e = extOf(rel);
    (readable(e) && file.size <= cfg.max_file_bytes ? docs : others).push({ rel, file });
  }
  const docBytes = docs.reduce((n, d) => n + d.file.size, 0);
  const hashBytes = others.reduce((n, d) => n + (d.file.size <= cfg.max_hash_bytes ? d.file.size : 0), 0);
  postMessage({ cmd: "progress", stage: "sort", docs: docs.length, others: others.length, skipped,
                docBytes, otherBytes: others.reduce((n, d) => n + d.file.size, 0) });

  // 2. read documents (the slow part: PDF and Word text extraction)
  let done = 0, bytesDone = 0, last = 0;
  const tRead = performance.now();
  const tick = (stage, total, bytesTotal, file, force) => {
    const now = performance.now();
    if (!force && now - last < 120) return;
    last = now;
    const el = now - (stage === "read" ? tRead : tHash);
    const rate = bytesDone > 0 && el > 1500 ? bytesDone / el : 0;
    const etaMs = rate ? (bytesTotal - bytesDone) / rate : null;
    postMessage({ cmd: "progress", stage, done, total, bytesDone, bytesTotal, file, etaMs });
  };
  for (const { rel, file } of docs) {
    tick("read", docs.length, docBytes, rel, done === 0);
    prepare(rel, new Uint8Array(await file.arrayBuffer()));   // only the extracted text is kept
    done++; bytesDone += file.size;
  }
  tick("read", docs.length, docBytes, "", true);

  // 3. fingerprint everything else (images, video, archives, very large files): listed, not read
  done = 0; bytesDone = 0;
  const tHash = performance.now();
  for (const { rel, file } of others) {
    tick("hash", others.length, hashBytes, rel, done === 0);
    if (file.size > cfg.max_hash_bytes) stub(rel, file.size, "unhashed", false);
    else {
      const sha = await sha256Hex(await file.arrayBuffer());
      stub(rel, file.size, sha, file.size <= cfg.max_file_bytes);
      bytesDone += file.size;
    }
    done++;
  }
  tick("hash", others.length, hashBytes, "", true);
  [isExcluded, extOf, readable, prepare, stub].forEach((f) => f.destroy());

  // 4. map: links, rules, decisions (one engine call)
  postMessage({ cmd: "progress", stage: "map", total: docs.length + others.length });
  py.globals.set("_root", root);
  const tMap = performance.now();
  void tMap;
  let lastMap = 0;
  const onMap = (done, total, rel, workDone, workTotal) => {   // called from inside the engine as it mines each file
    const now = performance.now();
    if (now - lastMap < 150) return;
    lastMap = now;
    const el = now - tMap, etaMs = workDone > 0 && el > 2000 ? (workTotal - workDone) * el / workDone : null;
    postMessage({ cmd: "progress", stage: "map", done, total, frac: workTotal ? workDone / workTotal : 0, file: rel, etaMs });
  };
  py.globals.set("_onmap", onMap);
  graphText = py.runPython("scan.scan_to_json(_files, _cfg_in, _root, _onmap)");
  py.globals.delete("_onmap");
  py.runPython("del _files");
  const files = docs.length + others.length;
  return { graph: graphText, sha256: await sha256Hex(new TextEncoder().encode(graphText)), files,
           readMs: Math.round(tMap - t0), scanMs: Math.round(performance.now() - tMap) };
}

function call(fn, ...args) {
  args.forEach((a, i) => py.globals.set("_a" + i, a));
  const out = py.runPython(fn + "(" + args.map((_, i) => "_a" + i).join(", ") + ")");
  args.forEach((_, i) => py.globals.delete("_a" + i));
  return out;
}

self.onmessage = async (ev) => {
  const { id, cmd } = ev.data;
  try {
    let result;
    if (cmd === "init") result = await init();
    else if (cmd === "scan") result = await doScan(ev.data.entries, ev.data.config);
    else if (cmd === "review") result = call("pack.review_json", graphText);
    else if (cmd === "build") result = call("pack.build_json", graphText, ev.data.fragments || "", JSON.stringify(ev.data.opts || {}));
    else if (cmd === "map") result = call("(lambda g: render.render_html(json.loads(g)).decode('utf-8'))", graphText);
    else throw new Error("unknown command " + cmd);
    postMessage({ id, ok: true, result });
  } catch (e) {
    postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
