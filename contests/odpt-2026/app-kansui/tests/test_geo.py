import unittest

import helpers  # noqa: F401
from kansui.geo import haversine_m, lonlat_to_tile_px


class GeoTest(unittest.TestCase):
    def test_haversine(self):
        self.assertAlmostEqual(haversine_m(35.0, 139.0, 35.0, 139.0), 0.0)
        # 緯度1度は約111.2km
        self.assertAlmostEqual(haversine_m(35.0, 139.0, 36.0, 139.0) / 1000, 111.2, delta=0.3)

    def test_tile_known(self):
        # 東京駅付近 z14 は x=14552, y=6451
        tx, ty, px, py = lonlat_to_tile_px(139.7671, 35.6812, 14)
        self.assertEqual((tx, ty), (14552, 6451))
        self.assertTrue(0 <= px < 256 and 0 <= py < 256)

    def test_tile_px_edges(self):
        tx, ty, px, py = lonlat_to_tile_px(-180.0, 0.0, 1)
        self.assertEqual((tx, px), (0, 0))
        tx, ty, px, py = lonlat_to_tile_px(179.99999999, 0.0, 1)
        self.assertEqual((tx, px), (1, 255))


if __name__ == "__main__":
    unittest.main()
