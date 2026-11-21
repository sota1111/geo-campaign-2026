"""作った web/data/kansui.json と、画面ファイルの安全側の取り決めを確かめる。"""
import json
import os
import re
import unittest

import helpers

WEB = os.path.join(helpers.APP, "web")
DATA = os.path.join(WEB, "data", "kansui.json")


def read(name):
    return open(os.path.join(WEB, name), encoding="utf-8").read()


@unittest.skipUnless(os.path.exists(DATA), "kansui.json が未生成")
class DataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.load(open(DATA, encoding="utf-8"))

    def test_meta(self):
        m = self.d["meta"]
        self.assertEqual(len(m["classes"]), 7)
        self.assertGreaterEqual(len(m["sources"]), 4)
        for s in m["sources"]:
            self.assertTrue(s["license"] and s["url"].startswith("https://"))
        ids = {s["id"] for s in m["sources"]}
        self.assertTrue({"gtfs", "osm", "flood", "tide"} <= ids)

    def test_counts_match(self):
        st = self.d["stations"]
        self.assertEqual(self.d["meta"]["counts"]["stations"], len(st))
        self.assertEqual(self.d["meta"]["counts"]["entrances"], sum(len(s["entrances"]) for s in st))
        self.assertEqual(self.d["meta"]["counts"]["bus_stops"], len(self.d["bus"]))
        self.assertGreater(len(st), 30)

    def test_class_invariants_and_inside_bbox(self):
        s0, w0, n0, e0 = self.d["meta"]["region"]["bbox"]
        for s in self.d["stations"]:
            for e in s["entrances"]:
                self.assertEqual(e["cls"], max(e["flood"], e["tide"]))
                self.assertTrue(0 <= e["cls"] <= 6)
                self.assertTrue(s0 <= e["lat"] <= n0 and w0 <= e["lon"] <= e0)
            m = s["summary"]
            self.assertEqual(m["n"], m["avoid"] + m["warn"] + m["none"])
            self.assertEqual(m["n"], len(s["entrances"]))

    def test_alt_references_valid_and_strictly_lower(self):
        st, bus = self.d["stations"], self.d["bus"]
        for s in st:
            for e in s["entrances"]:
                for a in e["alt"]["same"]:
                    self.assertLess(s["entrances"][a["i"]]["cls"], e["cls"])
                for a in e["alt"]["stations"]:
                    t = st[a["s"]]
                    c = t["entrances"][a["e"]]["cls"] if a["e"] >= 0 else t["cls"]
                    self.assertLess(c, e["cls"])
                    self.assertLessEqual(a["d"], 1500)
                for b in e["alt"]["bus"]:
                    self.assertLessEqual(b["d"], 500)
                    self.assertTrue(bus[b["b"]]["wd"] or bus[b["b"]]["hol"])

    def test_bus_fields(self):
        for b in self.d["bus"]:
            self.assertEqual(len(b["hourly"]), 24)
            self.assertEqual(sum(b["hourly"]), b["wd"])

    def test_has_contrast(self):
        # 区分が出入口ごとに分かれていること（全部同じ値だと比較にならない）
        cs = {e["cls"] for s in self.d["stations"] for e in s["entrances"]}
        self.assertGreaterEqual(len(cs), 3)


class WebFilesTest(unittest.TestCase):
    def test_no_outbound_send(self):
        js = read("app.js") + read("lib.js")
        for pat in (r"method\s*:\s*['\"]POST", r"XMLHttpRequest", r"sendBeacon", r"WebSocket", r"\.send\("):
            self.assertIsNone(re.search(pat, js), pat)

    def test_no_safe_claims(self):
        # 「安全」と断定する表現を使わない（否定の文脈「安全の保証ではない」だけ許す）
        txt = read("index.html") + read("app.js") + read("lib.js")
        for m in re.finditer("安全", txt):
            ctx = txt[m.start(): m.start() + 8]
            self.assertTrue(ctx.startswith("安全の保証ではあり") or ctx.startswith("安全の保証"), ctx)

    def test_disclaimer_present(self):
        h = read("index.html")
        self.assertIn("想定（ハザード）", h)
        self.assertIn("実際の冠水の予測ではありません", h)

    def test_no_red_green_in_css(self):
        css = read("style.css").lower()
        for bad in ("#00ff00", "#008000", "green", "#2e7d32", "#388e3c", "lime"):
            self.assertNotIn(bad, css)

    def test_mobile_viewport_and_no_hscroll_rule(self):
        self.assertIn("width=device-width", read("index.html"))
        self.assertIn("overflow-x: hidden", read("style.css"))

    def test_html_references_exist(self):
        h = read("index.html")
        for f in re.findall(r'(?:src|href)="((?!https?:)[^"?]+)', h):
            self.assertTrue(os.path.exists(os.path.join(WEB, f)), f)


if __name__ == "__main__":
    unittest.main()
