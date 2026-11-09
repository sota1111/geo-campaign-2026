import tempfile
import unittest
from pathlib import Path

from helpers import make_geojson_zip, make_mesh_zip
from lifemap import fetch, sources


class TestMesh(unittest.TestCase):
    def test_bounds_tokyo_station_3rd_mesh(self):
        # 東京駅付近（35.6812N, 139.7671E）は3次メッシュ 53394611
        la0, lo0, la1, lo1 = sources.mesh_bounds("53394611")
        self.assertTrue(la0 <= 35.6812 <= la1 and lo0 <= 139.7671 <= lo1)
        self.assertAlmostEqual(la1 - la0, 1 / 120)
        self.assertAlmostEqual(lo1 - lo0, 1 / 80)

    def test_bounds_500m_quadrants(self):
        sw = sources.mesh_bounds("533946111")
        ne = sources.mesh_bounds("533946114")
        self.assertAlmostEqual(sw[2] - sw[0], 1 / 240)
        self.assertAlmostEqual(ne[0], sw[0] + 1 / 240)
        self.assertAlmostEqual(ne[1], sw[1] + 1 / 160)
        # 4つの象限は3次メッシュを覆う
        whole = sources.mesh_bounds("53394611")
        self.assertAlmostEqual(sw[0], whole[0])
        self.assertAlmostEqual(ne[2], whole[2])

    def test_primary_mesh_codes(self):
        self.assertEqual(fetch.primary_mesh_codes([139.2, 35.5, 139.8, 35.9]), ["5339"])
        codes = fetch.primary_mesh_codes([130.5, 32.6, 131.0, 33.0])
        self.assertIn("4930", codes)
        self.assertIn("4830", codes)

    def test_read_population_aggregates_to_500m(self):
        rows = [("5339461111", 10, 3), ("5339461112", 5, "*"), ("5339461141", 7, 2), ("5339461142", "*", "*")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.zip"
            p.write_bytes(make_mesh_zip(rows))
            pop = sources.read_mesh_population(p)
        self.assertEqual(pop["533946111"], [15, 3])   # 250m×2 を集約。'*' は 0
        self.assertEqual(pop["533946114"], [7, 2])
        self.assertEqual(sum(v[0] for v in pop.values()), 22)


class TestFacilities(unittest.TestCase):
    def test_hospitals_only(self):
        feats = [
            {"type": "Feature", "properties": {"P04_001": 1, "P04_002": "中央病院"}, "geometry": {"type": "Point", "coordinates": [135.0, 35.0]}},
            {"type": "Feature", "properties": {"P04_001": 2, "P04_002": "内科医院"}, "geometry": {"type": "Point", "coordinates": [135.0, 35.0]}},
            {"type": "Feature", "properties": {"P04_001": 1, "P04_002": "遠方病院"}, "geometry": {"type": "Point", "coordinates": [150.0, 35.0]}},
        ]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "p04.zip"
            p.write_bytes(make_geojson_zip(feats))
            out = sources.read_hospitals(p, [134.0, 34.0, 136.0, 36.0])
        self.assertEqual(out, [(35.0, 135.0, "中央病院")])

    def test_schools_primary_and_middle_only(self):
        mk = lambda code, name: {"type": "Feature", "properties": {"P29_003": code, "P29_004": name},
                                 "geometry": {"type": "Point", "coordinates": [135.0, 35.0]}}
        feats = [mk(16001, "A小"), mk(16002, "B中"), mk(16004, "C高"), mk(16011, "D幼")]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "p29.zip"
            p.write_bytes(make_geojson_zip(feats))
            out = sources.read_schools(p, [134.0, 34.0, 136.0, 36.0])
        self.assertEqual([(o[2], o[3]) for o in out], [("A小", "小学校"), ("B中", "中学校")])


if __name__ == "__main__":
    unittest.main()
