import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
ODPT = HERE.parent.parent.parent / "odpt-2026" / "app" / "web" / "data"
DATA = HERE / "web" / "data"


class TestLibJs(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_lib(self):
        r = subprocess.run(["node", str(HERE / "tests" / "lib_test.js")], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("lib_test OK", r.stdout)

    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_syntax(self):
        for f in ("lib.js", "app.js"):
            r = subprocess.run(["node", "--check", str(HERE / "web" / f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class TestData(unittest.TestCase):
    def test_copy_identical_to_odpt(self):
        names = sorted(p.name for p in DATA.glob("*.json"))
        self.assertEqual(len(names), 11)
        for n in names:
            self.assertEqual((DATA / n).read_bytes(), (ODPT / n).read_bytes(), n)

    def test_integrity_and_licenses(self):
        idx = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(len(idx["regions"]), 5)
        for r in idx["regions"]:
            d = json.loads((DATA / f"{r['id']}.json").read_text(encoding="utf-8"))
            w = json.loads((DATA / f"whatif_{r['id']}.json").read_text(encoding="utf-8"))
            self.assertTrue(d["feeds"])
            for f in d["feeds"]:
                self.assertTrue(f["license"], f)
            for k, diffs in w["routes"].items():
                self.assertLess(int(k), len(d["routes"]))
                for c, lv in diffs:
                    self.assertLess(c, len(d["cells"]))
                    self.assertEqual(len(lv), 12)

    def test_static_only(self):
        for f in ("app.js", "lib.js", "index.html"):
            t = (HERE / "web" / f).read_text(encoding="utf-8")
            self.assertNotRegex(t, r"method\s*:\s*['\"]POST", f)
            self.assertNotIn("XMLHttpRequest", t)
            self.assertNotIn("sendBeacon", t)
            self.assertNotRegex(t, r"api[_-]?key", f)
        t = (HERE / "web" / "app.js").read_text(encoding="utf-8")
        for m in re.findall(r"getJSON\('([^']+)'", t):
            self.assertTrue(m.startswith("data/"), m)

    def test_limits_stated_on_screen(self):
        t = (HERE / "web" / "index.html").read_text(encoding="utf-8")
        self.assertIn("減便", t)
        self.assertIn("少なくとも", t)


if __name__ == "__main__":
    unittest.main()
