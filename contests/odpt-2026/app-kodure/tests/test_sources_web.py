import io
import re
import unittest
import zipfile

import kh
from kodure import sources

CACHE = kh.ROOT / "cache" / "mesh"
WEB = kh.ROOT / "web"


def mesh_zip(rows):
    head1 = ["KEY_CODE", "HTKSYORI", "HTKSAKI", "GASSAN", "T001102001", "T001102002", "T001102003", "T001102004"]
    head2 = ["", "", "", "", "　人口（総数）", "　人口（総数）　男", "　人口（総数）　女", "　０～１４歳人口　総数"]
    text = "\n".join(",".join(r) for r in [head1, head2] + rows) + "\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("tblT001102Q5339.txt", text.encode("cp932"))
    return io.BytesIO(buf.getvalue())


class TestMeshPopulation(unittest.TestCase):
    def test_aggregate_250_to_500_and_mask(self):
        rows = [["5339000511", "0", "", "", "10", "5", "5", "2"],
                ["5339000512", "0", "", "", "20", "10", "10", "3"],
                ["5339000513", "0", "", "", "*", "*", "*", "*"],      # 秘匿 → 0
                ["5339000514", "0", "", "", "5", "2", "3", "*"],
                ["5339000521", "0", "", "", "7", "3", "4", "1"],
                ["53390005", "0", "", "", "999", "", "", "999"]]       # 10桁でない行は除く
        got = sources.read_mesh_population_0_14(mesh_zip(rows))
        self.assertEqual(got["533900051"], [35, 5])
        self.assertEqual(got["533900052"], [7, 1])
        self.assertEqual(len(got), 2)

    def test_header_is_checked(self):
        # 0〜14歳の列が別の項目だったら（表の仕様が変わったら）気づけるよう、見出しを検査している
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("x.txt", "KEY_CODE,A,B,C,T001102001,x,y,T001102009\n,,,,,,,\n".encode("cp932"))
        with self.assertRaises(AssertionError):
            sources.read_mesh_population_0_14(io.BytesIO(buf.getvalue()))

    @unittest.skipUnless((CACHE / "T001102_5339.zip").exists(), "人口メッシュのキャッシュが無い")
    def test_real_file(self):
        got = sources.read_mesh_population_0_14(CACHE / "T001102_5339.zip")
        tot = sum(v[0] for v in got.values())
        kids = sum(v[1] for v in got.values())
        self.assertGreater(tot, 1_000_000)
        self.assertTrue(0.05 < kids / tot < 0.2)


class TestWebStatic(unittest.TestCase):
    def setUp(self):
        self.html = (WEB / "index.html").read_text(encoding="utf-8")
        self.app = (WEB / "app.js").read_text(encoding="utf-8")
        self.lib = (WEB / "lib.js").read_text(encoding="utf-8")

    def test_required_notices_present(self):
        self.assertIn("未収録", self.app)
        self.assertIn("大阪は時刻表のオープンデータが無いため未対応", self.app)
        self.assertIn("大阪は時刻表のオープンデータが無いため未対応", self.html)
        self.assertIn("位置のみ", self.app)
        self.assertIn("非商用", self.lib)
        self.assertIn("ODPT_NOTICE", self.app)
        self.assertIn("公共交通事業者への直接の問合せは行わないでください", self.lib)
        self.assertIn("国土数値情報", self.app)
        self.assertIn("地理院タイル", self.app)

    def test_assumptions_are_labeled(self):
        self.assertIn("仮定", self.app)

    def test_paths_are_relative_and_cdn_has_sri(self):
        for m in re.findall(r'(?:src|href)="([^"]+)"', self.html):
            if m.startswith("http"):
                continue
            self.assertFalse(m.startswith("/"), m)
        self.assertEqual(len(re.findall(r'integrity="sha384-', self.html)), 2)
        self.assertNotIn("url(/", (WEB / "style.css").read_text(encoding="utf-8"))
        self.assertNotRegex(self.app, r"fetch\(\s*['\"]/")

    def test_no_secret_in_web(self):
        for f in WEB.rglob("*"):
            if f.is_file() and f.suffix in (".js", ".html", ".css", ".json"):
                text = f.read_text(encoding="utf-8")
                self.assertNotIn("consumerKey", text, f.name)
                self.assertNotRegex(text, r"[0-9a-f]{64}", f.name)

    def test_only_get_requests(self):
        self.assertNotRegex(self.app, r"method\s*:\s*['\"](POST|PUT|DELETE)")


if __name__ == "__main__":
    unittest.main()
