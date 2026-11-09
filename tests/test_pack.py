"""python3 -m unittest discover -s tests   (from the handover repo root; needs private/fragments.json for unlocked tests)"""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import pack  # noqa: E402
import scan  # noqa: E402

FRAG = os.path.join(ROOT, "private", "fragments.json")
CORPUS = {
    "README.md": b"# Acme KB\n\nStart with [policy](policies/expenses.md). Contact ana@acme.test or +44 20 7946 0958.\n",
    "policies/expenses.md": b"# Expenses\n\nYou must file receipts within 30 days.\nDecided: we approved Stripe for billing.\n",
    "policies/old_expenses.md": b"# Old expenses\n\nSUPERSEDED. Superseded by `policies/expenses.md`.\nYou must file receipts within 60 days.\n",
    "projects/alpha/plan.md": b"# Alpha plan\n\nSee `policies/expenses.md`. Owner: Ana Ruiz.\nNever share client data.\n",
}
CFG = {"people": {"ana": ["Ana Ruiz"]}, "external": {"stripe": "Stripe"}}


@unittest.skipUnless(os.path.isfile(FRAG), "private fragments not present")
class Pack(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = scan.scan(CORPUS, CFG, "Acme")
        cls.fr = json.load(open(FRAG))

    def build(self, **o):
        o.setdefault("licence", "HX-T1")
        return pack.build(self.g, self.fr, o)

    def test_deterministic(self):
        self.assertEqual(self.build()["parts"], self.build()["parts"])

    def test_contains_rules_sources_and_prompt(self):
        p = self.build()["parts"][0]
        self.assertIn("“You must file receipts within 30 days.”", p)
        self.assertIn("`policies/expenses.md:3`", p)
        self.assertIn("KNOWLEDGE_BLUEPRINT.md", p)
        self.assertIn("policies/old_expenses.md → replaced by policies/expenses.md", p)

    def test_default_redaction_of_email_and_phone(self):
        r = self.build()
        self.assertNotIn("ana@acme.test", r["parts"][0])
        self.assertNotIn("7946 0958", r["parts"][0])
        self.assertGreaterEqual(r["stats"]["redactions"], 1)

    def test_custom_terms_and_exclusions(self):
        r = self.build(redact_terms=["Ana Ruiz"], exclude_folders=["projects"])
        p = r["parts"][0]
        self.assertNotIn("Ana Ruiz", p)
        self.assertNotIn("Never share client data", p)

    def test_fit_respects_budget(self):
        full = self.build()["stats"]["chars"]
        b = full - 150
        r = self.build(budget=b)
        self.assertLessEqual(r["stats"]["chars"], b)
        self.assertGreater(r["stats"]["items_dropped"], 0)
        self.assertIn("“", r["parts"][0])   # rules are kept first

    def test_split_mode_parts(self):
        r = self.build(mode="split", budget=self.build()["stats"]["chars"] - 150)
        self.assertGreater(r["stats"]["parts"], 1)
        self.assertIn("parts", r["parts"][0])  # multipart instruction present
        self.assertEqual(r["stats"]["items_included"], r["stats"]["items_available"])

    def test_watermark_traces_licence(self):
        p = self.build(licence="HX-AAAA")["parts"][0]
        self.assertEqual(pack.trace_licence(p, self.fr, ["HX-AAAA", "HX-BBBB", "HX-CCCC", "HX-DDDD"]), ["HX-AAAA"])

    def test_prompt_depends_on_folder(self):
        g2 = scan.scan({"a.md": b"# A\nplain notes\n"}, {}, "Solo")
        a = self.build()["parts"][0]
        b = pack.build(g2, self.fr, {"licence": "HX-T1"})["parts"][0]
        self.assertIn("superseded", a.lower())
        self.assertNotIn("have been superseded", b)


class Locked(unittest.TestCase):
    def test_locked_pack_has_no_prompt(self):
        g = scan.scan(CORPUS, CFG, "Acme")
        r = pack.build(g, None, {})
        self.assertIn("added when you unlock", r["parts"][0])
        self.assertFalse(r["stats"]["unlocked"])


if __name__ == "__main__":
    unittest.main()
