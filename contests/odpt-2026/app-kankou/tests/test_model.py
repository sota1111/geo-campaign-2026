import datetime as dt
import unittest

from helpers import make_feed_zip, make_p12_zip  # noqa: F401  (sys.path の設定も兼ねる)
from kankou import gtfs, model, sources

LAT, LON = 35.70, 139.79
CAL = [("wk", "1", "1", "1", "1", "1", "0", "0", "20260101", "20271231"),
       ("we", "0", "0", "0", "0", "0", "1", "1", "20260101", "20271231")]
BBOX = (139.7, 35.6, 139.9, 35.8)
TODAY = dt.date(2026, 11, 16)


def feed():
    stops = [("a", "A", LAT, LON), ("b", "B", LAT + 0.010, LON), ("c", "C", LAT + 0.020, LON), ("far", "遠い", 36.5, 140.5)]
    routes = [("r1", "観光1", ""), ("r2", "生活2", "")]
    trips = [
        ("t1", "r1", "wk", [("a", "10:00:00"), ("b", "10:05:00"), ("c", "10:10:00")]),
        ("t2", "r1", "wk", [("a", "10:30:00"), ("b", "10:35:00"), ("c", "10:40:00")]),   # 同じ所要時間 → 同じパターン
        ("t3", "r1", "wk", [("a", "11:00:00"), ("b", "11:08:00"), ("c", "11:10:00")]),   # 所要時間が違う → 別パターン
        ("t4", "r2", "we", [("a", "09:00:00"), ("c", "09:20:00"), ("far", "09:50:00")]),
    ]
    return make_feed_zip(stops, routes, trips, CAL)


def build():
    d = gtfs.load_feed(feed(), BBOX, TODAY)
    return model.build_patterns([{"key": "x", "name": "テスト", "data": d}])


class TestPatterns(unittest.TestCase):
    def test_trips_grouped_by_route_stops_and_runtime(self):
        stops, routes, patterns = build()
        self.assertEqual([r["name"] for r in routes], ["観光1", "生活2"])
        p1 = [p for p in patterns if p["route"] == 0]
        self.assertEqual(len(p1), 2)
        a = max(p1, key=lambda p: len(p["dep"]["wd"]))
        self.assertEqual(a["dep"]["wd"], [36000, 37800])
        self.assertEqual(a["off"], [0, 300, 600])
        self.assertEqual(a["dep"]["hol"], [])

    def test_stops_outside_bbox_are_dropped(self):
        stops, routes, patterns = build()
        names = [s["name"] for s in stops]
        self.assertNotIn("遠い", names)
        p2 = [p for p in patterns if p["route"] == 1][0]
        self.assertEqual(len(p2["stops"]), 2)           # far が落ちて a, c の2停留所
        self.assertEqual(p2["dep"]["hol"], [32400])

    def test_name_normalization_nfkc(self):
        self.assertEqual(model.norm("都０８（Ｔ０８）"), "都08(T08)")


class TestTourist(unittest.TestCase):
    def test_near_stops_and_route_share(self):
        stops, routes, patterns = build()
        spots = [{"name": "名所", "kind": "", "lat": LAT + 0.0102, "lon": LON}]   # B の約22m
        ts = model.tourist_stops(stops, spots, 300)
        names = {stops[i]["name"] for i in ts}
        self.assertEqual(names, {"B"})
        summ = model.route_summary(stops, routes, patterns, ts)
        self.assertEqual(summ[0]["tstops"], 1)
        self.assertAlmostEqual(summ[0]["share"], 1 / 3, places=3)
        self.assertEqual(summ[1]["tstops"], 0)
        self.assertEqual(summ[0]["trips_wd"], 3)

    def test_hourly_table_counts_stops_at_tourist_stops(self):
        stops, routes, patterns = build()
        spots = [{"name": "名所", "kind": "", "lat": LAT + 0.0102, "lon": LON}]
        ts = model.tourist_stops(stops, spots, 300)
        tab = {(t["route"], t["dt"], t["hour"]): (t["trips"], t["visits"]) for t in model.hourly_table(routes, patterns, ts)}
        # B の停車: 10:05, 10:35, 11:08 → 10時台2回、11時台1回
        self.assertEqual(tab[(0, "wd", 10)], (2, 2))
        self.assertEqual(tab[(0, "wd", 11)], (1, 1))
        self.assertNotIn((1, "wd", 9), tab)   # 観光地点に近い停留所を通らない系統は出ない

    def test_haversine_and_grid(self):
        self.assertAlmostEqual(model.haversine(LAT, LON, LAT + 0.01, LON), 1111.9, delta=2)
        g = model.Grid(250)
        g.add(0, LAT, LON)
        g.add(1, LAT + 0.001, LON)
        g.add(2, LAT + 0.02, LON)
        near = g.within(LAT, LON, 200)
        self.assertEqual([i for i, _ in near], [0, 1])


class TestSources(unittest.TestCase):
    def test_tourist_spots_filters_and_merges(self):
        z = make_p12_zip([
            ("浅草寺", "神社・寺院・教会", "台東区浅草2-3-1", 139.7967, 35.7147),
            ("三社祭", "年中行事", "台東区浅草2-3-1", 139.7967, 35.7147),            # 同じ座標 → まとめる
            ("箱根駅伝", "芸能・興行・イベント", "千代田区", 139.7643, 35.6875),      # 番地のないイベント → 除く
            ("隅田川橋梁群", "隅田川橋梁群", "中央区および台東区", 139.7935, 35.7009),  # 複数区 → 除く
            ("遠い所", "山岳", "長野県", 138.0, 36.0),                               # bbox 外
        ])
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".zip") as f:
            f.write(z)
            f.flush()
            spots = sources.read_tourist_spots(f.name, [139.73, 35.64, 139.87, 35.78])
        self.assertEqual(len(spots), 1)
        self.assertEqual(spots[0]["name"], "浅草寺・三社祭")
        self.assertAlmostEqual(spots[0]["lat"], 35.7147, places=3)


if __name__ == "__main__":
    unittest.main()
