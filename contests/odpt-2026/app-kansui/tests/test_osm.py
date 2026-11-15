import unittest

import helpers  # noqa: F401
from kansui import osm

DATA = {"elements": [
    {"type": "node", "id": 1, "lat": 35.1, "lon": 139.1, "tags": {"railway": "subway_entrance", "ref": "A1", "name": "蔵前駅"}},
    {"type": "node", "id": 2, "lat": 35.1, "lon": 139.1, "tags": {"railway": "train_station_entrance"}},
    {"type": "node", "id": 3, "lat": 35.2, "lon": 139.2, "tags": {"railway": "station", "station": "subway", "name": "蔵前", "operator": "東京都交通局"}},
    {"type": "way", "id": 4, "center": {"lat": 35.3, "lon": 139.3}, "tags": {"railway": "station", "name": "浅草橋"}},
    {"type": "node", "id": 5, "lat": 35.4, "lon": 139.4, "tags": {"railway": "station"}},
    {"type": "way", "id": 6, "tags": {"railway": "station", "name": "中心なし"}},
]}


class OsmTest(unittest.TestCase):
    def test_parse(self):
        st, en = osm.parse(DATA)
        self.assertEqual(len(en), 2)
        self.assertEqual(en[0]["ref"], "A1")
        self.assertEqual({s["name"]: s["kind"] for s in st}, {"蔵前": "subway", "浅草橋": "rail"})
        self.assertEqual([s for s in st if s["name"] == "浅草橋"][0]["lat"], 35.3)  # way は center

    def test_query(self):
        q = osm.query((35.0, 139.0, 36.0, 140.0))
        self.assertIn("subway_entrance", q)
        self.assertIn("35.0,139.0,36.0,140.0", q)


if __name__ == "__main__":
    unittest.main()
