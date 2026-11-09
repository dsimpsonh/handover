"""HANDOVER — pack builder (engine layer 2).

Turns a kb-blueprint-graph/1 graph (from scan.py) into a paste-ready HANDOVER pack: a short instruction, assembled
from licensed prompt fragments chosen by the folder's own features, followed by the ranked map, rules, decisions and
excerpts the owner approved, trimmed or split to fit the target AI.

Privacy by construction: the pack is built ONLY from the graph, which already holds nothing but bounded excerpts.
Pure, deterministic, stdlib only: runs under CPython and Pyodide.

Protection (see README): fragments are not shipped in the public app; they arrive after payment. Each pack is
assembled from the user's own map (no two prompts alike) and carries a licence watermark in its variant choices.
"""
from __future__ import annotations

import hashlib
import json
import posixpath
import re

PACK_VERSION = "1.0.0"

TARGETS = {
    "claude": {"name": "Claude", "file": "CLAUDE.md", "where": "a Claude Project's instructions or a CLAUDE.md file",
               "limit": 8000, "budget": 400_000},
    "chatgpt": {"name": "ChatGPT", "file": "CHATGPT_INSTRUCTIONS.md", "where": "a ChatGPT Project's instructions",
                "limit": 8000, "budget": 100_000},
    "gemini": {"name": "Gemini", "file": "GEMINI.md", "where": "a Gem's instructions", "limit": 8000,
               "budget": 400_000},
    "agents": {"name": "a coding agent", "file": "AGENTS.md", "where": "the root of a repository", "limit": 12000,
               "budget": 400_000},
}

RX_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RX_PHONE = re.compile(r"(?<![\w/])\+?\d[\d ().-]{7,}\d(?![\w/])")
RX_STRONG = re.compile(r"🔴|\b(?:must|never|always|do not|don't|forbidden|required|no exceptions)\b", re.I)
RX_ENTRY = re.compile(r"(?i)^(readme|index|claude|agents|thread|start|home|overview)\b")
WS = re.compile(r"\s+")

# section priority: lower = kept first when trimming
SECTIONS = [
    ("rules", "Standing rules (quoted exactly, with sources)", 1),
    ("read_first", "Read-first documents (ranked)", 2),
    ("decisions", "Decisions (with sources)", 3),
    ("superseded", "Retired and replacing documents", 4),
    ("folders", "Folder map", 5),
    ("people", "People mentioned", 6),
    ("systems", "Systems and tools mentioned", 7),
    ("gaps", "Gaps: unlinked files and broken references", 8),
    ("links", "Key links between documents", 9),
    ("outline", "Outline of other documents (headings)", 10),
]


def _h(s: str, n: int = 10) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:n]


def _norm(s: str) -> str:
    return WS.sub(" ", s.strip().lstrip("-*•>0123456789.) ").strip()).lower()


# ---------------------------------------------------------------------------------------------- analysis

def features(graph: dict) -> dict:
    st = graph["stats"]
    ext = st.get("files_by_ext", {})
    return {
        "has_supersedes": st["edges_by_type"].get("supersedes", 0) > 0,
        "has_people": st["nodes_by_kind"].get("person", 0) > 0,
        "has_external": st["nodes_by_kind"].get("external", 0) > 0,
        "has_decisions": st.get("decision_lines", 0) > 0,
        "has_office_docs": any(ext.get(e, 0) for e in ("docx", "pdf", "html", "htm")),
    }


def file_scores(graph: dict) -> dict:
    files = {n["id"]: n for n in graph["nodes"] if n["kind"] == "file"}
    inbound, outbound = {}, {}
    for e in graph["edges"]:
        if e["type"] == "mentions" and e["source"] in files and e["target"] in files:
            inbound.setdefault(e["target"], set()).add(e["source"])
            outbound.setdefault(e["source"], set()).add(e["target"])
    sc = {}
    for fid, n in files.items():
        s = 3 * len(inbound.get(fid, ())) + len(outbound.get(fid, ())) + (1 if n.get("headings") else 0)
        if RX_ENTRY.match(n["label"]):
            s += 5
        if n.get("archived") or n.get("superseded"):
            s -= 10
        sc[n["path"]] = s
    return sc


def items(graph: dict) -> list:
    """All candidate pack items, ranked. Each: {id, section, text, sources, score}. Stable ids for the review screen."""
    sc = file_scores(graph)
    nodes = {n["id"]: n for n in graph["nodes"]}
    out = []

    def add(section, key, text, sources, score):
        out.append({"id": "%s:%s" % (section, _h(key)), "section": section, "text": text,
                    "sources": sources, "score": score})

    for sec, rows in (("rules", graph.get("rules", [])), ("decisions", graph.get("decisions", []))):
        groups = {}
        for r in rows:
            groups.setdefault(_norm(r["text"]), []).append(r)
        for k, rs in groups.items():
            rs = sorted(rs, key=lambda r: (-sc.get(r["file"], 0), r["file"], r["line"]))
            score = sum(max(0, sc.get(r["file"], 0)) for r in rs) + len(rs) + (4 if RX_STRONG.search(rs[0]["text"]) else 0)
            if all(nodes.get("file:" + r["file"], {}).get("superseded") for r in rs):
                score -= 20
            add(sec, k, rs[0]["text"].strip(), ["%s:%d" % (r["file"], r["line"]) for r in rs], score)

    files = sorted((n for n in graph["nodes"] if n["kind"] == "file" and n.get("mined_text")),
                   key=lambda n: (-sc[n["path"]], n["path"]))
    for rank, n in enumerate(files):
        heads = [h[1] for h in n.get("headings", []) if h[0] <= 2][:6]
        desc = n.get("first_line") or ""
        if heads and desc.lstrip("# ").strip() == heads[0]:
            desc = ""
        text = n["path"] + (" — " + desc if desc else "") + (("\n  headings: " + " · ".join(heads)) if heads else "")
        add("read_first" if rank < 25 else "outline", n["path"], text, [n["path"]], sc[n["path"]] - rank * 0.01)

    for e in graph["edges"]:
        if e["type"] == "supersedes":
            new, old = nodes[e["source"]], nodes[e["target"]]
            add("superseded", e["id"], "%s → replaced by %s" % (old.get("path", old["label"]), new.get("path", new["label"])),
                ["%s:%d" % (e["src_file"], e["line"])], 50)
        elif e["type"] == "mentions" and e["source"].startswith("file:") and e["target"].startswith("file:"):
            s, t = e["source"][5:], e["target"][5:]
            add("links", e["id"], "%s → %s%s" % (s, t, " (×%d)" % e["count"] if e["count"] > 1 else ""),
                ["%s:%d" % (e["src_file"], e["line"])], sc.get(s, 0) + sc.get(t, 0) + e["count"])

    by_target = {}
    for e in graph["edges"]:
        if e["type"] in ("mentions_person", "uses_external"):
            by_target.setdefault(e["target"], []).append(e)
    for tid, es in sorted(by_target.items()):
        nd = nodes[tid]
        srcs = sorted({x["src_file"] for x in es}, key=lambda p: (-sc.get(p, 0), p))
        sec = "people" if nd["kind"] == "person" else "systems"
        add(sec, tid, "%s — in %d file%s, e.g. %s" % (nd["label"], len(srcs), "" if len(srcs) == 1 else "s",
                                                     ", ".join(srcs[:3])), srcs[:5], len(srcs))

    folders = [n for n in graph["nodes"] if n["kind"] == "folder"]
    fcount = {}
    for n in graph["nodes"]:
        if n["kind"] == "file":
            fcount[n["folder"]] = fcount.get(n["folder"], 0) + 1
    deps = {}
    for e in graph["edges"]:
        if e["type"] == "depends_on":
            deps.setdefault(e["source"], []).append((e["count"], nodes[e["target"]]["label"]))
    for f in sorted(folders, key=lambda f: -fcount.get(f["label"], 0)):
        d = sorted(deps.get(f["id"], []), reverse=True)[:5]
        add("folders", f["id"], "%s/ — %d files%s" % (f["label"], fcount.get(f["label"], 0),
                                                      ("; cites " + ", ".join("%s (%d)" % (b, a) for a, b in d)) if d else ""),
            [f["label"] + "/"], fcount.get(f["label"], 0))

    fi = graph.get("findings", {})
    for p in fi.get("orphans", [])[:60]:
        add("gaps", "orphan:" + p, "Not linked from any other document: " + p, [p], 1)
    for u in fi.get("unresolved", [])[:60]:
        add("gaps", "ref:%s:%s:%s" % (u["src_file"], u["line"], u["ref"]),
            "Reference to a file not in the folder: %s" % u["ref"], ["%s:%d" % (u["src_file"], u["line"])], 0.5)

    order = {s: p for s, _, p in SECTIONS}
    out.sort(key=lambda i: (order[i["section"]], -i["score"], i["id"]))
    return out


# --------------------------------------------------------------------------------------------- redaction

def redactor(terms=(), emails=True, phones=True):
    rx_terms = [re.compile(re.escape(t), re.I) for t in sorted({t.strip() for t in terms if t and t.strip()},
                                                               key=len, reverse=True)]
    count = [0]

    def run(s: str) -> str:
        for rx in rx_terms:
            s, n = rx.subn("[REDACTED]", s)
            count[0] += n
        if emails:
            s, n = RX_EMAIL.subn("[REDACTED]", s)
            count[0] += n
        if phones:
            s, n = RX_PHONE.subn("[REDACTED]", s)
            count[0] += n
        return s
    run.count = count
    return run


# ------------------------------------------------------------------------------------------- prompt

def watermark_bits(licence: str, n: int) -> list:
    d = hashlib.sha256(("handover-wm|" + licence).encode("utf-8")).digest()
    return [(d[i // 8] >> (i % 8)) & 1 for i in range(n)]


def assemble_prompt(fragments: dict, feats: dict, ctx: dict, licence: str) -> str:
    chosen = [f for f in fragments["order"]
              if f in fragments["always"] or feats.get(fragments["when"].get(f, ""), False)]
    bits = watermark_bits(licence, len(fragments["order"]))
    paras = []
    for f in chosen:
        variants = fragments["fragments"][f]
        v = variants[bits[fragments["order"].index(f)] % len(variants)]
        paras.append(v.format(**ctx))
    return "\n\n".join(paras)


def trace_licence(pack_text: str, fragments: dict, candidates) -> list:
    """Leak tracing: which licence IDs are consistent with the variant choices visible in a pack."""
    hits = []
    for lic in candidates:
        bits = watermark_bits(lic, len(fragments["order"]))
        ok, seen = True, 0
        for i, f in enumerate(fragments["order"]):
            vs = fragments["fragments"][f]
            if len(vs) < 2:
                continue
            probe = [v.split("{")[0][:60] for v in vs]
            present = [bool(p) and p in pack_text for p in probe]
            if any(present):
                seen += 1
                if not present[bits[i] % len(vs)]:
                    ok = False
                    break
        if ok and seen:
            hits.append(lic)
    return hits


# ------------------------------------------------------------------------------------------- render

def build(graph: dict, fragments: dict | None, opts: dict | None = None) -> dict:
    """opts: target, licence, exclude (item ids), exclude_folders, redact_terms, redact_emails, redact_phones,
    mode ('fit'|'split'), budget (override chars). Returns {parts, stats, items_included, items_dropped}."""
    o = {"target": "claude", "licence": "HX-UNLICENSED", "exclude": [], "exclude_folders": [], "redact_terms": [],
         "redact_emails": True, "redact_phones": True, "mode": "fit", "budget": None}
    o.update(opts or {})
    tgt = TARGETS[o["target"]]
    budget = int(o["budget"] or tgt["budget"])
    org = graph.get("root_label") or "this organisation"
    red = redactor(o["redact_terms"], o["redact_emails"], o["redact_phones"])
    excl = set(o["exclude"])
    xf = tuple(f.rstrip("/") + "/" for f in o["exclude_folders"])

    def excluded(it):
        if it["id"] in excl:
            return True
        return bool(xf) and all(s.startswith(xf) for s in it["sources"])

    pool = [it for it in items(graph) if not excluded(it)]
    st = graph["stats"]
    profile = ("- Folder: {org}\n- Files: {files:,} ({mined:,} read as text)\n- Formats: {fmt}\n- Links between documents: "
               "{links:,}\n- Rule lines: {rules:,} · decision lines: {dec:,}\n- Corpus fingerprint: {fp}").format(
        org=org, files=st["files"], mined=st["files_mined"],
        fmt=", ".join("%s %d" % (k, v) for k, v in sorted(st["files_by_ext"].items(), key=lambda x: -x[1])[:8]),
        links=st["edges_by_type"].get("mentions", 0), rules=st["rule_lines"], dec=st["decision_lines"],
        fp=graph["corpus_sha256"][:16])

    def line(it):
        src = it["sources"]
        tail = "" if it["section"] in ("read_first", "outline", "folders", "links", "people", "systems") else \
            " — " + ", ".join("`%s`" % s for s in src[:4]) + (" +%d more" % (len(src) - 4) if len(src) > 4 else "")
        body = it["text"] if it["section"] not in ("rules", "decisions") else "“%s”" % it["text"]
        return "- " + red(body) + tail + "\n"

    rendered = [(it, line(it)) for it in pool]
    titles = {s: t for s, t, _ in SECTIONS}

    def compose(chunk, part, parts, prompt):
        head = "<!-- HANDOVER pack v%s · %s · part %d of %d · licence %s -->\n" % (
            PACK_VERSION, org, part, parts, o["licence"])
        out = [head, "# HANDOVER pack — %s (part %d of %d)\n\n" % (org, part, parts)]
        if part == 1:
            out += ["## Instructions for the AI\n\n", prompt, "\n\n## Folder profile\n\n", profile, "\n"]
        cur = None
        for it, ln in chunk:
            if it["section"] != cur:
                cur = it["section"]
                out.append("\n## %s\n\n" % titles[cur])
            out.append(ln)
        if part == parts:
            out.append("\n<!-- end of HANDOVER pack · licence %s -->\n" % o["licence"])
        return "".join(out)

    def prompt_for(parts):
        if not fragments:
            return "_Instructions are added when you unlock HANDOVER._"
        ctx = {"org": org, "parts": parts, "target_name": tgt["name"], "target_file": tgt["file"],
               "target_where": tgt["where"], "target_limit": "{:,}".format(tgt["limit"])}
        f = dict(features(graph), multipart=parts > 1, has_redactions=red.count[0] > 0)
        return assemble_prompt(fragments, f, ctx, o["licence"])

    fixed = len(compose([], 1, 1, prompt_for(2))) + 400
    dropped = []
    if o["mode"] == "fit":
        keep, used = [], fixed
        for it, ln in rendered:
            if used + len(ln) + 60 <= budget:
                keep.append((it, ln))
                used += len(ln)
            else:
                dropped.append(it["id"])
        chunks = [keep]
    else:
        chunks, cur, used = [], [], fixed
        for it, ln in rendered:
            if cur and used + len(ln) + 60 > budget:
                chunks.append(cur)
                cur, used = [], 300
            cur.append((it, ln))
            used += len(ln)
        chunks.append(cur)
    n = len(chunks)
    prompt = prompt_for(n)
    parts = [compose(c, i + 1, n, prompt) for i, c in enumerate(chunks)]
    by_sec = {}
    for c in chunks:
        for it, _ in c:
            by_sec[it["section"]] = by_sec.get(it["section"], 0) + 1
    return {"version": PACK_VERSION, "target": o["target"], "target_file": tgt["file"], "licence": o["licence"],
            "parts": parts,
            "stats": {"parts": n, "chars": sum(len(p) for p in parts), "approx_tokens": sum(len(p) for p in parts) // 4,
                      "items_available": len(pool), "items_included": sum(by_sec.values()), "items_dropped": len(dropped),
                      "by_section": by_sec, "redactions": red.count[0], "budget_chars": budget,
                      "unlocked": bool(fragments)}}


def review_json(graph_json: str) -> str:
    """Browser entry: candidate items for the review screen."""
    g = json.loads(graph_json)
    its = items(g)
    return json.dumps({"items": its, "sections": [{"id": s, "title": t} for s, t, _ in SECTIONS],
                       "folders": sorted(n["label"] for n in g["nodes"] if n["kind"] == "folder"),
                       "targets": TARGETS}, ensure_ascii=False)


def build_json(graph_json: str, fragments_json: str, opts_json: str) -> str:
    """Browser entry: build the pack."""
    frag = json.loads(fragments_json) if fragments_json else None
    return json.dumps(build(json.loads(graph_json), frag, json.loads(opts_json or "{}")), ensure_ascii=False)
