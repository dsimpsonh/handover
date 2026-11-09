/* HANDOVER — engine worker.
 * Runs Pyodide (self-hosted under /vendor/pyodide/) and the Python engine (scan.py, pack.py, render.py) off the UI
 * thread. Files are read here, inside this tab. Nothing in this file makes a network request except loading the
 * engine's own files from this site.
 *
 * Messages in:  {id, cmd: "init"} | {id, cmd: "scan", entries:[{path, file}], config} | {id, cmd: "review"}
 *               | {id, cmd: "build", fragments, opts} | {id, cmd: "map"}
 * Messages out: {id, ok, result} | {id, ok:false, error} | {cmd:"progress", phase, done, total}
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

async function doScan(entries, configJson) {
  if (!configJson) configJson = await fetch("/engine/default_config.json").then((r) => r.text());
  const root = entries.length ? entries[0].path.split("/")[0] : "folder";
  py.globals.set("_cfg_in", configJson || "{}");
  const cfg = JSON.parse(py.runPython("json.dumps(scan.merge_config(json.loads(_cfg_in)))"));
  const isExcluded = py.globals.get("scan").is_excluded;
  const cfgPy = py.toPy(cfg);
  const files = new Map();
  const t0 = performance.now();
  let done = 0;
  for (const { path, file } of entries) {
    done++;
    if (done % 100 === 0) postMessage({ cmd: "progress", phase: "read", done, total: entries.length });
    const rel = path.split("/").slice(1).join("/");
    if (!rel || isExcluded(rel, cfgPy)) continue;
    if (file.size > cfg.max_hash_bytes) { files.set(rel, { size: file.size, sha256: "unhashed" }); continue; }
    const buf = await file.arrayBuffer();
    if (buf.byteLength > cfg.max_file_bytes) files.set(rel, { size: buf.byteLength, sha256: await sha256Hex(buf) });
    else files.set(rel, new Uint8Array(buf));
  }
  cfgPy.destroy(); isExcluded.destroy();
  const tRead = performance.now();
  postMessage({ cmd: "progress", phase: "scan", done: files.size, total: files.size });
  const pyFiles = py.toPy(files, { depth: 2 });
  py.globals.set("_files", pyFiles); py.globals.set("_root", root);
  graphText = py.runPython("scan.scan_to_json(_files, _cfg_in, _root)");
  pyFiles.destroy(); py.globals.delete("_files");
  const tScan = performance.now();
  return { graph: graphText, sha256: await sha256Hex(new TextEncoder().encode(graphText)), files: files.size,
           readMs: Math.round(tRead - t0), scanMs: Math.round(tScan - tRead) };
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
