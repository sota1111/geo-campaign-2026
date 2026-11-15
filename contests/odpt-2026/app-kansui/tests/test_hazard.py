import io
import os
import tempfile
import unittest
import urllib.error

import helpers  # noqa: F401
from kansui import hazard
from kansui.geo import lonlat_to_tile_px

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


def png(boxes, size=256):
    """boxes: [(x0,y0,x1,y1,(r,g,b,a))]"""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for x0, y0, x1, y1, c in boxes:
        for y in range(y0, y1):
            for x in range(x0, x1):
                im.putpixel((x, y), c)
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


class ClassifyTest(unittest.TestCase):
    def test_legend_colors(self):
        exp = {(247, 245, 169): 1, (255, 216, 192): 2, (255, 183, 183): 3, (255, 145, 145): 4,
               (242, 133, 201): 5, (220, 122, 220): 6, (248, 225, 166): 2, (255, 255, 179): 1}
        for c, v in exp.items():
            self.assertEqual(hazard.classify_color(c), v)

    def test_tolerance_and_unknown(self):
        self.assertEqual(hazard.classify_color((248, 244, 170)), 1)
        self.assertEqual(hazard.classify_color((0, 0, 255)), 0)
        self.assertEqual(hazard.classify_color((255, 255, 255)), 0)

    def test_labels(self):
        self.assertEqual(len(hazard.CLASS_LABELS), 7)
        self.assertEqual(hazard.CLASS_LABELS[2], "0.5〜3m")


@unittest.skipIf(Image is None, "Pillow が無い")
class SamplerTest(unittest.TestCase):
    def test_decode_transparent_is_zero(self):
        t = hazard.decode_tile(png([(10, 10, 20, 20, (255, 183, 183, 255)), (30, 30, 40, 40, (255, 183, 183, 0))]))
        self.assertEqual(t[15][15], 3)
        self.assertEqual(t[35][35], 0)
        self.assertEqual(t[0][0], 0)

    def test_sampler_neighbor_max(self):
        lon, lat, z = 139.80, 35.70, 17
        tx, ty, px, py = lonlat_to_tile_px(lon, lat, z)
        # 点の1画素隣にだけ 3〜5m の色。半径1なら拾い、半径0なら拾わない。
        b = png([(px + 1, py, px + 2, py + 1, (255, 183, 183, 255))])

        def fetch(layer, zz, x, y):
            return b if layer == hazard.LAYERS["flood"] and (x, y) == (tx, ty) else None
        self.assertEqual(hazard.Sampler(fetcher=fetch, z=z, radius=1)(lon, lat), {"flood": 3, "tide": 0})
        self.assertEqual(hazard.Sampler(fetcher=fetch, z=z, radius=0)(lon, lat)["flood"], 0)

    def test_sampler_requests_only_adjacent_tiles(self):
        lon, lat, z = 139.80, 35.70, 17
        tx, ty, _, _ = lonlat_to_tile_px(lon, lat, z)
        seen = set()

        def fetch(layer, zz, x, y):
            seen.add((x, y))
            return None
        hazard.Sampler(fetcher=fetch, z=z, radius=1).level("L", lon, lat)
        self.assertIn((tx, ty), seen)
        self.assertTrue(all(abs(x - tx) <= 1 and abs(y - ty) <= 1 for x, y in seen))

    def test_sampler_reads_across_tile_edge(self):
        # 右隣タイルの左端に色がある場合、点が右端の画素なら拾う
        z = 17
        n = 2 ** z
        tx, ty = 100000, 50000
        lon = (tx + 255.5 / 256) / n * 360 - 180
        import math
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + 0.5) / n))))
        right = png([(0, 0, 1, 256, (220, 122, 220, 255))])

        def fetch(layer, zz, x, y):
            return right if (layer == hazard.LAYERS["flood"] and (x, y) == (tx + 1, ty)) else None
        self.assertEqual(hazard.Sampler(fetcher=fetch, z=z, radius=1).level(hazard.LAYERS["flood"], lon, lat), 6)

    def test_fetch_tile_caches_404(self):
        n = {"c": 0}

        def opener(url):
            n["c"] += 1
            raise urllib.error.HTTPError(url, 404, "nf", {}, None)
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(hazard.fetch_tile("L", 17, 1, 2, cache_dir=d, opener=opener))
            self.assertIsNone(hazard.fetch_tile("L", 17, 1, 2, cache_dir=d, opener=opener))
            self.assertEqual(n["c"], 1)

    def test_fetch_tile_other_error_raises(self):
        def opener(url):
            raise urllib.error.HTTPError(url, 500, "err", {}, None)
        with self.assertRaises(urllib.error.HTTPError):
            hazard.fetch_tile("L", 17, 1, 2, opener=opener)

    def test_fetch_tile_returns_bytes_and_uses_cache(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(hazard.fetch_tile("L", 17, 1, 2, cache_dir=d, opener=lambda u: b"PNG"), b"PNG")
            self.assertEqual(hazard.fetch_tile("L", 17, 1, 2, cache_dir=d, opener=lambda u: b"X"), b"PNG")
            self.assertTrue(os.path.exists(os.path.join(d, "L", "17", "1", "2.png")))


if __name__ == "__main__":
    unittest.main()
