"""Streaming parity: scanning prepared (pre-extracted) entries must give byte-identical output to scanning raw bytes.
The browser streams files one at a time through scan.prepare(), so this is the guarantee that it matches the CLI."""
import io, json, os, sys, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
import scan  # noqa: E402


def docx(paras):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
        z.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
    return b.getvalue()


def corpus():
    pdf = (b"%PDF-1.4\n1 0 obj<<>>stream\nBT (Rule: deposit is 30 percent) Tj ET\nendstream endobj\n%%EOF")
    return {
        "Policies/Refund policy.md": b"# Refunds\nRule: refunds within 14 days. See [prices](../Pricing/Price list.pdf)\nDecision: no couriers for London.\n",
        "Pricing/Price list.pdf": pdf,
        "Pricing/notes.html": b"<html><body><h1>Pricing</h1><p>We always quote in GBP. See Refund policy.md</p></body></html>",
        "Handbook.docx": docx(["Studio handbook", "Rule: reply within 24 hours", "Decided: use our own van"]),
        "Broken.docx": b"not a zip",
        "data/big.csv": b"a,b\n" + b"1,2\n" * 80_000,          # > max_data_bytes -> skipped:large_data
        "data/small.csv": b"name,rule\nx,always invoice monthly\n",
        "img/logo.png": b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 40,
        "skills/quote-writer/SKILL.md": b"---\nname: quote-writer\n---\nUse Price list.pdf. Never discount below 10%.\n",
        "video/huge.bin": b"\0" * 6_000_000,                      # > max_file_bytes -> skipped:too_large
    }


def test_prepare_matches_raw():
    files = corpus()
    cfg = {}
    a = scan.scan_to_json(files, json.dumps(cfg), "studio")
    prepared = {rel: scan.prepare(rel, raw, scan.merge_config(cfg)) for rel, raw in files.items()}
    b = scan.scan_to_json(prepared, json.dumps(cfg), "studio")
    assert a == b
    g = json.loads(a)
    ex = {n["path"]: n["extractor"] for n in g["nodes"] if n["kind"] == "file"}
    assert ex["data/big.csv"] == "skipped:large_data" and ex["video/huge.bin"] == "skipped:too_large"
    assert ex["img/logo.png"] == "none" and ex["Broken.docx"].startswith("error:")


def test_prepared_entries_hold_no_bytes():
    for rel, raw in corpus().items():
        p = scan.prepare(rel, raw)
        assert "pre" not in p or not isinstance(p["pre"], (bytes, bytearray))
        assert set(p) <= {"size", "sha256", "pre"}


if __name__ == "__main__":
    test_prepare_matches_raw(); test_prepared_entries_hold_no_bytes(); print("ok")
