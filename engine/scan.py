#!/usr/bin/env python3
"""kb_scanner/scan.py — Knowledge Blueprint scanner (engine layer 1).

Generalised from an earlier single-project system-map script (8 Nov 2026 build):
  * input is ANY folder (or, in the browser, the files a user picks) — the scanner builds its own inventory;
  * edge patterns (people, external systems, custom tags, rule lines) come from a config, not built-in constants;
  * the core is a pure function  scan(files, config) -> graph  with no file system, clock or network access,
    so the SAME module runs under CPython (CLI) and Pyodide (browser) and gives byte-identical graph.json.

Standard library only. Python >= 3.9.

CLI:
    python3 scan.py <folder> [-o graph.json] [--config cfg.json] [--html graph.html] [--root-label NAME]

Browser (Pyodide):
    import scan; scan.scan_to_json(files_dict, config_json_text, root_label)  -> str
"""
from __future__ import annotations

import hashlib
import html as _html
import json
import posixpath
import re
import zipfile
import zlib
from html.parser import HTMLParser
from io import BytesIO
from xml.etree import ElementTree as ET

SCHEMA = "kb-blueprint-graph/1"
ENGINE_VERSION = "0.1.0"

# --------------------------------------------------------------------------------------------- config

DEFAULT_CONFIG = {
    # files
    "max_file_bytes": 5_000_000,            # larger files are inventoried (hash, size) but not mined
    "max_hash_bytes": 200_000_000,          # larger still: size only, sha256 recorded as "unhashed" (CLI and browser alike)
    "data_ext": ["csv", "tsv", "json", "jsonl", "ndjson", "xml", "log"],
    "max_data_bytes": 200_000,              # data tables / logs are mined only when small (they are not prose)
    "exclude_dirs": [".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv", ".idea", ".vscode",
                     ".Trash", ".cache", "dist", "build"],
    "exclude_names": [".DS_Store", "Thumbs.db", "desktop.ini"],
    "exclude_hidden": True,
    "ref_extensions": ["md", "markdown", "txt", "docx", "pdf", "html", "htm", "xlsx", "csv", "tsv", "pptx", "json",
                       "yaml", "yml", "py", "js", "ts", "mjs", "css", "sh", "command", "ipynb", "toml", "ini", "sql", "r", "go",
                       "java", "rb", "png", "jpg", "jpeg", "gif", "svg", "zip", "eml", "msg", "key", "pages", "numbers",
                       "xlsm", "ppt", "doc", "xls", "rtf", "odt", "xml", "mp4", "mov", "mp3", "wav", "m4a", "webm",
                       "webp", "woff", "woff2", "webmanifest", "bundle", "tex", "log", "jsonl"],
    # edge patterns
    "people": {},                            # {"ana-lopez": ["Ana Lopez", "Ana"]}
    "external": {},                          # {"github": "github\\.com|GitHub"}
    "custom": [],                            # [{"type": "ticket", "regex": "\\b(OPS-\\d+)\\b"}] -> node tag:<group 1>
    "rule_regex": r"\b(?:rule|never|always|must|must not|shall|required|forbidden|do not|don't|policy|no exceptions)\b",
    "decision_regex": r"\b(?:decided|decision|agreed|approved|signed off|locked|resolved to)\b",
    # metadata kept per file for the synthesis layer (bounded excerpts, never the full text)
    "max_headings_per_file": 40,
    "max_rules_per_file": 25,
    "max_decisions_per_file": 25,
    "excerpt_chars": 240,
}


def merge_config(user: dict | None) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    for k, v in (user or {}).items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(cfg.get(k), dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    return cfg


# ---------------------------------------------------------------------------------------------- utils

def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def eid(src: str, dst: str, typ: str) -> str:
    return hashlib.sha1(("%s|%s|%s" % (src, dst, typ)).encode("utf-8")).hexdigest()[:16]


def short(s: str, n: int) -> str:
    s = RX_WS.sub(" ", s.strip())
    return s if len(s) <= n else s[: n - 1] + "…"


def ext_of(rel: str) -> str:
    b = posixpath.basename(rel)
    return b.rsplit(".", 1)[1].lower() if "." in b.strip(".") else ""


def is_excluded(rel: str, cfg: dict) -> bool:
    parts = rel.split("/")
    if any(p in cfg["exclude_dirs"] for p in parts[:-1]):
        return True
    if parts[-1] in cfg["exclude_names"]:
        return True
    if cfg["exclude_hidden"] and any(p.startswith(".") for p in parts):
        return True
    return False


def dumps(graph: dict) -> bytes:
    """Canonical serialisation. Byte-identical across CPython and Pyodide."""
    return (json.dumps(graph, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")


# ----------------------------------------------------------------------------------------- extractors
# Each returns plain text lines. Links are rewritten as markdown "[text](target)" so one miner handles every format;
# headings are rewritten as "# " .. "###### ".

TEXT_EXT = {"md", "markdown", "txt", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "py", "js", "ts", "mjs",
            "css", "sh", "command", "toml", "ini", "sql", "r", "go", "java", "rb", "eml", "xml", "rst", "log", "tex"}
HTML_EXT = {"html", "htm"}


class _HTMLText(HTMLParser):
    BLOCK = {"p", "div", "li", "tr", "br", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "h5",
             "h6", "pre", "blockquote", "table", "ul", "ol", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.cur, self.href, self.atext, self.skip, self.hlevel = [], [], None, [], 0, 0
        self.src_lines, self.cur_line = [], None      # source line of each output line (evidence points at the file)

    def _flush(self):
        line = "".join(self.cur).strip()
        if line:
            self.out.append(("#" * self.hlevel + " " if self.hlevel else "") + line)
            self.src_lines.append(self.cur_line or self.getpos()[0])
        self.cur, self.cur_line = [], None

    def _mark(self, offset=0):
        if self.cur_line is None:
            self.cur_line = self.getpos()[0] + offset

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "noscript"):
            self.skip += 1
        elif tag in self.BLOCK:
            self._flush()
            if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.hlevel = int(tag[1])
        if tag == "a":
            self._mark()
            self.href = dict(attrs).get("href")
            self.atext = []

    def handle_endtag(self, tag):
        if tag in ("style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag == "script":
            self._flush()
        elif tag == "a" and self.href is not None:
            self.cur.append("[%s](%s)" % ("".join(self.atext).strip() or "link", self.href))
            self.href = None
        elif tag in self.BLOCK:
            self._flush()
            if tag.startswith("h") and len(tag) == 2:
                self.hlevel = 0

    def handle_data(self, data):
        if self.skip:
            return
        if "\n" in data and self.href is None:          # keep multi-line text (scripts, <pre>) line-addressable
            parts = data.split("\n")
            for k, part in enumerate(parts[:-1]):
                if part.strip():
                    self._mark(k)
                self.cur.append(part)
                self._flush()
            if parts[-1].strip():
                self._mark(len(parts) - 1)
            self.cur.append(parts[-1])
            return
        if data.strip():
            self._mark()
        if self.href is not None:
            self.atext.append(data)
        else:
            self.cur.append(data)


def extract_html(raw: bytes):
    p = _HTMLText()
    p.feed(raw.decode("utf-8", "replace"))
    p.close()
    p._flush()
    return p.out, p.src_lines


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def extract_docx(raw: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(raw)) as z:
        doc = ET.fromstring(z.read("word/document.xml"))
        rels = {}
        try:
            for r in ET.fromstring(z.read("word/_rels/document.xml.rels")).iter(_PR + "Relationship"):
                rels[r.get("Id")] = r.get("Target")
        except KeyError:
            pass
    lines = []
    for p in doc.iter(_W + "p"):
        level = 0
        ps = p.find("%spPr/%spStyle" % (_W, _W))
        if ps is not None:
            m = re.match(r"(?i)heading\s*(\d)|title", ps.get(_W + "val") or "")
            if m:
                level = int(m.group(1)) if m.group(1) else 1
        parts = []
        for el in p:
            if el.tag == _W + "r":
                parts.append("".join(t.text or "" for t in el.iter(_W + "t")))
            elif el.tag == _W + "hyperlink":
                txt = "".join(t.text or "" for t in el.iter(_W + "t"))
                tgt = rels.get(el.get(_R + "id")) or ("#" + (el.get(_W + "anchor") or ""))
                parts.append("[%s](%s)" % (txt or "link", tgt))
        line = "".join(parts).strip()
        if line:
            lines.append(("#" * level + " " if level else "") + line)
    return lines


def _pdf_streams(raw: bytes):
    """Yield (dictionary bytes, stream bytes). Linear scan with bytes.find — no backtracking regex over the file,
    so a 5 MB PDF costs one pass, not a quadratic search."""
    pos = 0
    while True:
        k = raw.find(b"stream", pos)
        if k < 0:
            return
        if raw[k - 3:k] == b"end":            # 'endstream'
            pos = k + 6
            continue
        start = k + 6
        if raw[start:start + 2] == b"\r\n":
            start += 2
        elif raw[start:start + 1] in (b"\n", b"\r"):
            start += 1
        else:
            pos = k + 6
            continue
        end = raw.find(b"endstream", start)
        if end < 0:
            return
        d0 = raw.rfind(b"obj", max(0, k - 4096), k)   # whole object dictionary, nested dicts included
        head = raw[d0:k] if d0 >= 0 else b""
        yield head, raw[start:end].rstrip(b"\r\n")
        pos = end + 9


_PDF_STR = re.compile(rb"\((?:\\.|[^\\()])*\)")
_PDF_URI = re.compile(rb"/URI\s*\(((?:\\.|[^\\()])*)\)")
_PDF_TOKEN = re.compile(rb"\[(?:[^\]\\]|\\.)*\]\s*TJ|\((?:\\.|[^\\()])*\)\s*(?:Tj|'|\")|T\*|-?[\d.]+\s+-?[\d.]+\s+T[dD]|ET")


def _pdf_text_tokens(body: bytes):
    """Tokens from BT..ET text objects only. Vector paths (most of a designed PDF's content stream) sit outside
    text objects, so skipping them is what keeps a 5 MB carousel PDF from costing seconds."""
    pos = 0
    while True:
        b = body.find(b"BT", pos)
        if b < 0:
            return
        e = body.find(b"ET", b + 2)
        if e < 0:
            e = len(body)
        yield from _PDF_TOKEN.finditer(body, b + 2, e)
        yield _ET_SENTINEL
        pos = e + 2


class _Sentinel:
    @staticmethod
    def group(_):
        return b"ET"


_ET_SENTINEL = _Sentinel()


def _pdf_unescape(s: bytes) -> str:
    out, i = bytearray(), 0
    esc = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}
    while i < len(s):
        c = s[i:i + 1]
        if c == b"\\" and i + 1 < len(s):
            n = s[i + 1:i + 2]
            if n in esc:
                out += esc[n]; i += 2; continue
            m = re.match(rb"[0-7]{1,3}", s[i + 1:i + 4])
            if m:
                out.append(int(m.group(0), 8) & 0xFF); i += 1 + len(m.group(0)); continue
            i += 2; continue
        out += c; i += 1
    return out.decode("latin-1")


def extract_pdf(raw: bytes) -> list[str]:
    """Best-effort stdlib PDF text: uncompressed or Flate content streams, Tj/TJ operators, /URI annotations.
    Encrypted PDFs, CID/Type0 fonts without ToUnicode and scanned images return little or nothing — the graph
    then records the file with mined_text=False rather than inventing content."""
    lines, cur = [], []
    for head, body in _pdf_streams(raw):
        if b"/Image" in head or b"/FontFile" in head or b"/Length1" in head or b"/ICCBased" in head:
            continue                           # images, embedded fonts, colour profiles: no page text
        if b"/FlateDecode" in head:
            try:
                body = zlib.decompressobj().decompress(body, 4_000_000)
            except zlib.error:
                continue
        elif b"/Filter" in head:
            continue
        for t in _pdf_text_tokens(body):
            tok = t.group(0)
            if tok.endswith(b"TJ"):
                cur.append("".join(_pdf_unescape(s[1:-1]) for s in _PDF_STR.findall(tok)))
            elif tok.endswith((b"Tj", b"'", b'"')):
                s = _PDF_STR.match(tok)
                if tok.endswith((b"'", b'"')) and cur:
                    lines.append("".join(cur)); cur = []
                cur.append(_pdf_unescape(s.group(0)[1:-1]))
            else:  # line move or end of text object
                if cur:
                    lines.append("".join(cur)); cur = []
    if cur:
        lines.append("".join(cur))
    for u in _PDF_URI.findall(raw):
        lines.append("[link](%s)" % _pdf_unescape(u))
    return [l.strip() for l in lines if l.strip()]


def extract(rel: str, raw: bytes):
    """-> (lines|None, extractor, source_line_numbers|None). None = not a text-bearing format (still inventoried).
    Line numbers: text/html -> line in the source file; docx -> paragraph number; pdf -> text line in reading order."""
    e = ext_of(rel)
    try:
        if e in TEXT_EXT:
            return raw.decode("utf-8", "replace").splitlines(), "text", None
        if e in HTML_EXT:
            lines, src = extract_html(raw)
            return lines, "html", src
        if e == "docx":
            return extract_docx(raw), "docx", None
        if e == "pdf":
            return extract_pdf(raw), "pdf", None
    except Exception as ex:  # malformed file: inventory it, record why, keep going
        return None, "error:%s" % type(ex).__name__, None
    return None, "none", None


# -------------------------------------------------------------------------------------------- resolver

class Resolver:
    """Turns a textual reference into a file in the corpus. Order: exact -> relative to the citing file ->
    unique path suffix -> unique basename (same-folder, then same-top-folder tiebreaks). Never guesses."""

    def __init__(self, relpaths):
        self.rel = set(relpaths)
        self.by_suffix, self.by_base_ci, self.by_stem_ci = {}, {}, {}
        for r in sorted(relpaths):
            parts = r.split("/")
            for k in range(1, len(parts)):
                self.by_suffix.setdefault("/".join(parts[k:]), []).append(r)
            b = parts[-1]
            self.by_base_ci.setdefault(b.lower(), []).append(r)
            self.by_stem_ci.setdefault(posixpath.splitext(b)[0].lower(), []).append(r)

    @staticmethod
    def pick(cands, src):
        if len(cands) == 1:
            return cands[0]
        sdir = posixpath.dirname(src)
        same = [c for c in cands if posixpath.dirname(c) == sdir]
        if len(same) == 1:
            return same[0]
        live = [c for c in cands if not RX_ARCHIVED.search(c)]
        if len(live) == 1:
            return live[0]
        top = src.split("/", 1)[0]
        same_top = [c for c in (live or cands) if c.split("/", 1)[0] == top]
        if len(same_top) == 1:
            return same_top[0]
        return None

    def resolve(self, ref: str, src: str):
        """-> (relpath|None, status) status: exact|relative|suffix|basename|ambiguous|unresolved|skip"""
        r = ref.strip().strip("'\"<>()[]{},;").replace("\\", "/")
        r = re.sub(r"[#?].*$", "", r)
        try:  # %20 etc. in links
            from urllib.parse import unquote
            r = unquote(r)
        except Exception:
            pass
        if not r or r.endswith("/") or re.match(r"^[a-z][a-z0-9+.-]*:", r, re.I):
            return None, "skip"
        r = re.sub(r"^(?:\./)+", "", r)
        if r in self.rel:
            return r, "exact"
        cand = posixpath.normpath(posixpath.join(posixpath.dirname(src), r))
        if cand in self.rel:
            return cand, "relative"
        if "/" in r:
            parts = [p for p in r.split("/") if p not in ("", ".", "~")]
            hits = []
            for k in range(len(parts) - 1):          # longest suffix first: absolute paths, "<Root>/x/y", "$HOME/.."
                tail = "/".join(parts[k:])
                hits = ([tail] if tail in self.rel else []) or self.by_suffix.get(tail) or \
                    [x for x in self.by_base_ci.get(parts[-1].lower(), []) if x.lower().endswith("/" + tail.lower())
                     or x.lower() == tail.lower()]
                if hits:
                    break
            if hits:
                got = self.pick(hits, src)
                return (got, "suffix") if got else (None, "ambiguous")
        cands = self.by_base_ci.get(posixpath.basename(r).lower())
        if cands:
            got = self.pick(cands, src)
            return (got, "basename") if got else (None, "ambiguous")
        return None, "unresolved"

    def resolve_stem(self, name: str, src: str):
        n = name.strip()
        if n.lower() in self.by_base_ci:
            return self.resolve(n, src)
        cands = self.by_stem_ci.get(n.lower()) or self.by_stem_ci.get(posixpath.basename(n).lower())
        if not cands:
            return None, "unresolved"
        got = self.pick(cands, src)
        return (got, "stem") if got else (None, "ambiguous")


# ----------------------------------------------------------------------------------------------- miner

RX_BACKTICK = re.compile(r"`([^`\n]{3,300})`")
RX_MDLINK = re.compile(r"\]\(\s*<?([^)\s>]{1,400})>?(?:\s+\"[^\"]*\")?\s*\)")
RX_WIKI = re.compile(r"\[\[([^\]\n|#]{1,200})(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]")
RX_WS = re.compile(r"\s+")
RX_SUPERSEDED_HDR = re.compile(r"\bSUPERSEDED\b")
RX_ARCHIVED = re.compile(r"(^|/)(_?archive|old|deprecated)(/|$)", re.I)
RX_LIVE_OK = re.compile(r"(?i)supersed|replac|archiv|previous|old")
RX_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+|\bwww\.\S+", re.I)
RX_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
RX_SUPER_BY = re.compile(r"superseded by|replaced by|now lives in", re.I)
RX_SUPERSEDES = re.compile(r"\bsupersedes\b", re.I)


def _bare_rx(exts):
    alt = "|".join(sorted((re.escape(e) for e in exts), key=len, reverse=True))
    return (re.compile(r"(?<![\w/.~-])([\w\-.()/~]*?[\w\-()]\.(?:%s))(?![\w])" % alt, re.I),
            re.compile(r"\.(?:%s)$" % alt, re.I))


def candidates(line: str, rx_bare, rx_ext):
    """-> list of (ref, via) with via in backtick|link|bare. Order-stable, de-duplicated."""
    out = []
    for m in RX_MDLINK.finditer(line):
        out.append((m.group(1), "link"))
    for m in RX_BACKTICK.finditer(line):
        s = m.group(1).strip()
        if rx_ext.search(s.split(" ")[0]) or rx_ext.search(s):
            out.append((s, "backtick"))
    spans = [m.span(1) for m in RX_MDLINK.finditer(line)] + [m.span() for m in RX_URL.finditer(line)]
    for m in rx_bare.finditer(line):
        if any(a <= m.start() < b for a, b in spans):
            continue
        out.append((m.group(1), "bare"))
    seen, res = set(), []
    for c, via in out:
        c = c.strip().rstrip(".,;:")
        if c and c not in seen and len(c) < 400:
            seen.add(c)
            res.append((c, via))
    return res


MAX_LINE = 4000
RX_CHUNK = re.compile(r".{1,%d}(?:[\s,;\]\)}>]|$)|.{1,%d}" % (MAX_LINE, MAX_LINE), re.S)


def _bounded(lines):
    """(line_no, text) with minified/one-line blobs (embedded JSON, bundled JS) cut into <=4 KB pieces at a
    delimiter, so mining stays linear. Every piece keeps its original line number."""
    for j, line in enumerate(lines, 1):
        if len(line) <= MAX_LINE:
            yield j, line
        else:
            for m in RX_CHUNK.finditer(line):
                yield j, m.group(0)


def prepare(rel: str, raw: bytes, config: dict | None = None) -> dict:
    """Reduce one file to what scan() needs, so a caller can stream files one at a time and hold only text.
    scan({rel: prepare(rel, raw)}) == scan({rel: raw}) byte for byte (tested). Raw bytes can be dropped afterwards."""
    cfg = merge_config(config or {})
    size = len(raw)
    out = {"size": size, "sha256": sha(raw)}
    if size > cfg["max_file_bytes"]:
        return out                                   # inventoried, not mined (same as a too-large stub)
    if ext_of(rel) in cfg["data_ext"] and size > cfg["max_data_bytes"]:
        out["pre"] = (None, "skipped:large_data", None)
        return out
    out["pre"] = extract(rel, raw)
    return out


def scan(files, config: dict | None = None, root_label: str = "corpus", progress=None) -> dict:
    """files: iterable of (relpath, bytes) or dict relpath->bytes. Pure: no I/O, no clock."""
    cfg = merge_config(config)
    items = sorted(files.items() if isinstance(files, dict) else files)
    items = [(r.replace("\\", "/").lstrip("/"), b) for r, b in items]
    # a value may be raw bytes, or a stub {"size": int, "sha256": str} for files too large to hand over whole
    items = [(r, b) for r, b in items if r and not is_excluded(r, cfg)]
    rels = [r for r, _ in items]
    resolver = Resolver(rels)
    rx_bare, rx_ext = _bare_rx(cfg["ref_extensions"])
    rx_ext_any = re.compile(r"\.(?:%s)(?!\w)" % "|".join(sorted(map(re.escape, cfg["ref_extensions"]), key=len, reverse=True)), re.I)
    rx_rule = re.compile(cfg["rule_regex"], re.I)
    rx_dec = re.compile(cfg["decision_regex"], re.I)
    people_rx = [(pid, re.compile(r"(?<!\w)(?:%s)(?!\w)" % "|".join(re.escape(n) for n in names)))
                 for pid, names in sorted(cfg["people"].items()) if names]
    ext_rx = [(xid, re.compile(rx, re.I if rx == rx.lower() else 0)) for xid, rx in sorted(cfg["external"].items())]
    custom_rx = [(c["type"], re.compile(c["regex"])) for c in cfg["custom"]]
    X = cfg["excerpt_chars"]

    nodes, edges, unresolved, rules, decisions = {}, {}, [], [], []

    def add_node(n):
        nodes.setdefault(n["id"], n)

    def add_edge(src, dst, typ, src_file, line_no, text, via=None):
        if src == dst:
            return
        k = eid(src, dst, typ)
        e = edges.get(k)
        if e is None:
            edges[k] = {"id": k, "source": src, "target": dst, "type": typ, "src_file": src_file, "line": line_no,
                        "lines": [line_no], "count": 1, "evidence": short(text, X), "via": sorted({via}) if via else []}
        else:
            e["count"] += 1
            if len(e["lines"]) < 25 and line_no not in e["lines"]:
                e["lines"].append(line_no)
            if via and via not in e["via"]:
                e["via"] = sorted(set(e["via"]) | {via})

    tops = sorted({r.split("/", 1)[0] for r in rels if "/" in r})
    for t in tops:
        add_node({"id": "folder:" + t, "kind": "folder", "label": t, "path": t + "/"})
    for pid, names in sorted(cfg["people"].items()):
        add_node({"id": "person:" + pid, "kind": "person", "label": names[0] if names else pid})
    for xid in sorted(cfg["external"]):
        add_node({"id": "ext:" + xid, "kind": "external", "label": xid})

    totals = {"bytes": 0, "lines": 0}
    if progress is not None:   # observer only: never changes the output. Weight = lines to mine (+1 per file).
        weights = [1 + (len(r["pre"][0] or ()) if isinstance(r, dict) and r.get("pre") else 0) for _, r in items]
        w_total, w_done = sum(weights), 0
    for k_item, (rel, raw) in enumerate(items):
        if progress is not None:
            if k_item % 10 == 0:
                progress(k_item, len(items), rel, w_done, w_total)
            w_done += weights[k_item]
        top = rel.split("/", 1)[0] if "/" in rel else "(root)"
        stub = isinstance(raw, dict)
        size = int(raw["size"]) if stub else len(raw)
        n = {"id": "file:" + rel, "kind": "file", "label": posixpath.basename(rel), "path": rel, "ext": ext_of(rel),
             "size": size, "sha256": str(raw["sha256"]) if stub else sha(raw), "folder": top, "mined_text": False, "extractor": "none",
             "headings": [], "first_line": None, "superseded": False, "archived": bool(
                RX_ARCHIVED.search(rel))}
        add_node(n)
        totals["bytes"] += size
        pre = raw.get("pre") if stub else None   # already extracted, file by file (browser streaming path)
        if (stub and pre is None) or size > cfg["max_file_bytes"]:
            n["extractor"] = "skipped:too_large"
            continue
        if n["ext"] in cfg["data_ext"] and size > cfg["max_data_bytes"]:
            n["extractor"] = "skipped:large_data"
            continue
        lines, how, srcmap = pre if pre is not None else extract(rel, raw)
        n["extractor"] = how
        if lines is None:
            continue
        n["mined_text"] = True
        n["line_count"] = len(lines)
        totals["lines"] += len(lines)
        src = n["id"]
        nrule = ndec = 0
        for j, line in _bounded(lines):
            if not line.strip():
                continue
            i = srcmap[j - 1] if srcmap else j
            if n["first_line"] is None:
                n["first_line"] = short(line, X)
            if i <= 15 and RX_SUPERSEDED_HDR.search(line):
                n["superseded"] = True
            hm = RX_HEADING.match(line)
            if hm and len(n["headings"]) < cfg["max_headings_per_file"]:
                n["headings"].append([len(hm.group(1)), short(hm.group(2), X), i])
            if nrule < cfg["max_rules_per_file"] and not hm and rx_rule.search(line):
                rules.append({"file": rel, "line": i, "text": short(line, 400)}); nrule += 1
            if ndec < cfg["max_decisions_per_file"] and not hm and rx_dec.search(line):
                decisions.append({"file": rel, "line": i, "text": short(line, 400)}); ndec += 1
            hits = []
            refs = candidates(line, rx_bare, rx_ext) if ("](" in line or rx_ext_any.search(line)) else ()
            for c, via in refs:
                tgt, st = resolver.resolve(c, rel)
                if st == "skip":
                    continue
                if tgt:
                    if tgt != rel:
                        pos = max(0, line.find(c))
                        hits.append((pos, tgt))
                        add_edge(src, "file:" + tgt, "mentions", rel, i, line, via)
                elif via != "bare" or "/" in c:
                    unresolved.append({"src_file": rel, "line": i, "ref": c, "kind": st, "via": via})
            for m in RX_WIKI.finditer(line):
                tgt, st = resolver.resolve_stem(m.group(1), rel)
                if tgt and tgt != rel:
                    hits.append((m.start(), tgt))
                    add_edge(src, "file:" + tgt, "mentions", rel, i, line, "wikilink")
                elif not tgt:
                    unresolved.append({"src_file": rel, "line": i, "ref": "[[%s]]" % m.group(1), "kind": st,
                                       "via": "wikilink"})
            if hits:
                hits.sort()
                mb = RX_SUPER_BY.search(line)
                ms = RX_SUPERSEDES.search(line)
                if mb:
                    after = [h for h in hits if h[0] >= mb.end()]
                    before = [h for h in hits if h[0] < mb.start()]
                    newer = after[0][1] if after else None
                    older = before[-1][1] if before else (rel if newer else None)
                    if newer and older and newer != older:
                        add_edge("file:" + newer, "file:" + older, "supersedes", rel, i, line)
                elif ms:
                    after = [h for h in hits if h[0] >= ms.end()]
                    before = [h for h in hits if h[0] < ms.start()]
                    newer = before[-1][1] if before else rel
                    for h in after[:1] if before else after:
                        if h[1] != newer:
                            add_edge("file:" + newer, "file:" + h[1], "supersedes", rel, i, line)
            for pid, rx in people_rx:
                if rx.search(line):
                    add_edge(src, "person:" + pid, "mentions_person", rel, i, line)
            for xid, rx in ext_rx:
                if rx.search(line):
                    add_edge(src, "ext:" + xid, "uses_external", rel, i, line)
            for typ, rx in custom_rx:
                for m in rx.finditer(line):
                    val = m.group(1) if rx.groups else m.group(0)
                    add_node({"id": "%s:%s" % (typ, val), "kind": typ, "label": val})
                    add_edge(src, "%s:%s" % (typ, val), "tagged_" + typ, rel, i, line)

    for e in edges.values():
        if e["type"] == "supersedes" and e["target"] in nodes:
            nodes[e["target"]]["superseded"] = True

    # derived folder dependencies: folder A depends on folder B when a file in A cites a file in B
    dep = {}
    for e in edges.values():
        if e["type"] != "mentions":
            continue
        a, b = nodes[e["source"]]["folder"], nodes[e["target"]]["folder"]
        if a != b and a != "(root)" and b != "(root)":
            d = dep.setdefault((a, b), {"count": 0, "first": e})
            d["count"] += e["count"]
            if (e["src_file"], e["line"]) < (d["first"]["src_file"], d["first"]["line"]):
                d["first"] = e
    for (a, b), d in sorted(dep.items()):
        f = d["first"]
        k = eid("folder:" + a, "folder:" + b, "depends_on")
        edges[k] = {"id": k, "source": "folder:" + a, "target": "folder:" + b, "type": "depends_on",
                    "src_file": f["src_file"], "line": f["line"], "lines": [f["line"]], "count": d["count"],
                    "evidence": f["evidence"], "via": ["derived"]}

    inbound = {}
    for e in edges.values():
        if e["type"] in ("mentions", "supersedes"):
            inbound[e["target"]] = inbound.get(e["target"], 0) + 1
    doc_ext = {"md", "markdown", "txt", "docx", "pdf", "html", "htm"}
    entry = re.compile(r"(?i)^(readme|index|claude|agents|thread|home|start)\b")
    orphans = sorted(n["path"] for n in nodes.values() if n["kind"] == "file" and n["ext"] in doc_ext
                     and not n["archived"] and not entry.match(n["label"]) and inbound.get(n["id"], 0) == 0)
    sup_live = sorted({(e["src_file"], e["line"], nodes[e["target"]]["path"]) for e in edges.values()
                       if e["type"] == "mentions" and nodes[e["target"]]["superseded"]
                       and not nodes[e["source"]]["superseded"] and not nodes[e["source"]]["archived"]
                       and not RX_LIVE_OK.search(e["evidence"])})
    unresolved.sort(key=lambda u: (u["src_file"], u["line"], u["ref"]))
    rules.sort(key=lambda r: (r["file"], r["line"]))
    decisions.sort(key=lambda r: (r["file"], r["line"]))

    node_list = sorted(nodes.values(), key=lambda n: n["id"])
    edge_list = sorted(edges.values(), key=lambda e: (e["type"], e["source"], e["target"]))
    kinds, etypes, exts, extractors = {}, {}, {}, {}
    for n in node_list:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
        if n["kind"] == "file":
            exts[n["ext"] or "(none)"] = exts.get(n["ext"] or "(none)", 0) + 1
            extractors[n["extractor"]] = extractors.get(n["extractor"], 0) + 1
    for e in edge_list:
        etypes[e["type"]] = etypes.get(e["type"], 0) + 1
    manifest_basis = "\n".join("%s  %s" % (n["sha256"], n["path"]) for n in node_list if n["kind"] == "file")
    return {
        "schema": SCHEMA, "engine_version": ENGINE_VERSION, "root_label": root_label,
        "config_sha256": sha(json.dumps(cfg, sort_keys=True).encode("utf-8")),
        "corpus_sha256": sha(manifest_basis.encode("utf-8")),
        "stats": {"files": len(items), "bytes": totals["bytes"], "text_lines": totals["lines"],
                  "nodes": len(node_list), "edges": len(edge_list), "nodes_by_kind": kinds, "edges_by_type": etypes,
                  "files_by_ext": exts, "files_by_extractor": extractors,
                  "files_mined": sum(1 for n in node_list if n.get("mined_text")),
                  "unresolved_refs": len(unresolved), "orphans": len(orphans), "superseded_cited_live": len(sup_live),
                  "rule_lines": len(rules), "decision_lines": len(decisions)},
        "nodes": node_list, "edges": edge_list,
        "rules": rules, "decisions": decisions,
        "findings": {"orphans": orphans, "unresolved": unresolved,
                     "superseded_cited_live": [{"src_file": a, "line": b, "target": c} for a, b, c in sup_live]},
    }


def scan_to_json(files, config_json: str = "{}", root_label: str = "corpus", progress=None) -> str:
    """Browser entry point. files: dict relpath -> bytes, or relpath -> prepare() result (streamed).
    progress(files_done, files_total, relpath, work_done, work_total) is called during mining; it only observes."""
    files = {k: (dict(v) if isinstance(v, dict) else bytes(v)) for k, v in dict(files).items()}
    return dumps(scan(files, json.loads(config_json or "{}"), root_label, progress)).decode("utf-8")


# ------------------------------------------------------------------------------------------------- CLI

def read_folder(root: str, cfg: dict):
    import os
    out = {}
    root = os.path.abspath(root)
    for d, dirs, fs in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in cfg["exclude_dirs"] and not (cfg["exclude_hidden"] and x.startswith(".")))
        for f in sorted(fs):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            if is_excluded(rel, cfg) or not os.path.isfile(p) or os.path.islink(p):
                continue
            size = os.path.getsize(p)
            if size > cfg["max_hash_bytes"]:
                out[rel] = {"size": size, "sha256": "unhashed"}
                continue
            if size > cfg["max_file_bytes"]:   # stream-hash, never hold large binaries in memory
                h = hashlib.sha256()
                with open(p, "rb") as fh:
                    for c in iter(lambda: fh.read(1 << 20), b""):
                        h.update(c)
                out[rel] = {"size": size, "sha256": h.hexdigest()}
                continue
            with open(p, "rb") as fh:
                out[rel] = fh.read()
    return out


def atomic_write(path: str, data: bytes) -> None:
    import os
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, ".%s.tmp-%d" % (os.path.basename(path), os.getpid()))
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def main(argv=None) -> int:
    import argparse, os, sys, time
    ap = argparse.ArgumentParser(description="Knowledge Blueprint scanner — folder in, graph.json out.")
    ap.add_argument("folder")
    ap.add_argument("-o", "--out", default="graph.json")
    ap.add_argument("--config", help="JSON config overriding DEFAULT_CONFIG")
    ap.add_argument("--html", help="also write the interactive map (needs render.py beside this file)")
    ap.add_argument("--root-label", help="label stored in the graph (default: folder name)")
    a = ap.parse_args(argv)
    user = {}
    if a.config:
        with open(a.config, encoding="utf-8") as f:
            user = json.load(f)
    cfg = merge_config(user)
    t0 = time.perf_counter()
    files = read_folder(a.folder, cfg)
    t1 = time.perf_counter()
    g = scan(files, user, a.root_label or os.path.basename(os.path.abspath(a.folder)))
    t2 = time.perf_counter()
    data = dumps(g)
    atomic_write(a.out, data)
    if a.html:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import render
        atomic_write(a.html, render.render_html(g))
    s = g["stats"]
    print("files=%d mined=%d nodes=%d edges=%d unresolved=%d read=%.2fs scan=%.2fs graph_sha256=%s"
          % (s["files"], s["files_mined"], s["nodes"], s["edges"], s["unresolved_refs"], t1 - t0, t2 - t1, sha(data)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
