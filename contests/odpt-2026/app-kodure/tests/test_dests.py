import io
import struct
import unittest
import zipfile

import kh  # noqa: F401
from kodure import dests, shp

CACHE = kh.ROOT / "cache" / "ksj"
BBOX = [139.62, 35.58, 139.92, 35.80]


def make_shp(points):
    body = b""
    for i, (x, y) in enumerate(points):
        rec = struct.pack("<idd", 1, x, y)
        body += struct.pack(">ii", i + 1, len(rec) // 2) + rec
    header = struct.pack(">i", 9994) + b"\0" * 20 + struct.pack(">i", (100 + len(body)) // 2) + struct.pack("<ii", 1000, 1) + b"\0" * 64
    return header + body


def make_dbf(fields, rows, enc="cp932"):
    """fields [(名前, 長さ)]、rows [[値...]]（すべて文字列として書く）。"""
    rec_len = 1 + sum(ln for _n, ln in fields)
    hdr_len = 32 + 32 * len(fields) + 1
    head = struct.pack("<BBBBIHH", 3, 26, 11, 14, len(rows), hdr_len, rec_len) + b"\0" * 20
    for name, ln in fields:
        head += name.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([ln, 0]) + b"\0" * 14
    head += b"\x0d"
    body = b""
    for r in rows:
        body += b" " + b"".join(str(v).encode(enc).ljust(ln, b" ") for v, (_n, ln) in zip(r, fields))
    return head + body + b"\x1a"


def make_zip(points, fields, rows, stem="X"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"{stem}.shp", make_shp(points))
        z.writestr(f"{stem}.dbf", make_dbf(fields, rows))
    return io.BytesIO(buf.getvalue())


P13F = [("P13_001", 10), ("P13_003", 40), ("P13_004", 4), ("P13_008", 12)]
P27F = [("P27_001", 8), ("P27_004", 8), ("P27_005", 40)]


class TestShp(unittest.TestCase):
    def test_read_points(self):
        z = make_zip([(139.7, 35.7), (139.8, 35.6)], P13F, [["東京都", "上野公園", "4", "538507"], ["東京都", "小公園", "1", "300"]])
        got = shp.read_points_zip(z)
        self.assertEqual(len(got), 2)
        self.assertAlmostEqual(got[0][0], 139.7)
        self.assertEqual(got[0][2]["P13_003"], "上野公園")
        self.assertEqual(got[1][2]["P13_008"], "300")


class TestParks(unittest.TestCase):
    def test_area_type_and_bbox_filters(self):
        pts = [(139.7, 35.7)] * 6 + [(150.0, 35.7)]
        rows = [["東京都", "大公園", "4", "150000"],     # 10ha以上 → park_l
                ["東京都", "中公園", "2", "30000"],      # → park_m
                ["東京都", "小公園", "1", "5000"],       # 面積不足
                ["東京都", "緑道", "12", "80000"],       # 緑道は除く
                ["東京都", "緩衝", "10", "80000"],       # 緩衝緑地は除く
                ["東京都", "境界", "4", str(dests.PARK_MIN_M2)],   # ちょうど下限 → 含む
                ["東京都", "範囲外", "4", "900000"]]
        got = dests.read_parks(make_zip(pts, P13F, rows), BBOX)
        names = {g[2]: g[3] for g in got}
        self.assertEqual(names, {"大公園": "park_l", "中公園": "park_m", "境界": "park_m"})


class TestCulture(unittest.TestCase):
    def test_classification(self):
        pts = [(139.7, 35.7)] * 7
        rows = [["13101", "03004", "しながわ水族館"], ["13101", "03005", "東京都恩賜上野動物園"], ["13101", "03005", "神代植物公園"],
                ["13101", "03002", "科学技術館"], ["13101", "03001", "山種美術館"], ["13101", "03003", "千代田図書館"],
                ["13101", "03115", "どこかの施設"]]
        got = dests.read_culture(make_zip(pts, P27F, rows), BBOX)
        self.assertEqual({g[2]: g[3] for g in got},
                         {"しながわ水族館": "aquarium", "東京都恩賜上野動物園": "zoo", "神代植物公園": "botanical", "科学技術館": "museum"})

    def test_dedupe(self):
        items = [(139.7, 35.7, "A", "zoo", 0, ""), (139.70001, 35.70001, "A", "zoo", 0, ""), (139.7, 35.7, "B", "zoo", 0, "")]
        self.assertEqual(len(dests.dedupe(items)), 2)


@unittest.skipUnless((CACHE / "P13-11_13_GML.zip").exists() and (CACHE / "P27-13_13.zip").exists(), "国土数値情報のキャッシュが無い")
class TestRealData(unittest.TestCase):
    def test_tokyo(self):
        got = dests.read_destinations(CACHE / "P13-11_13_GML.zip", CACHE / "P27-13_13.zip", BBOX)
        kinds = {g[3] for g in got}
        self.assertEqual(kinds, {k for k, _ in dests.KINDS})
        names = {g[2] for g in got}
        self.assertIn("東京都恩賜上野動物園", names)
        self.assertIn("しながわ水族館", names)
        self.assertIn("駒沢オリンピック公園", names)
        for g in got:
            self.assertTrue(BBOX[0] <= g[0] <= BBOX[2] and BBOX[1] <= g[1] <= BBOX[3])


if __name__ == "__main__":
    unittest.main()
