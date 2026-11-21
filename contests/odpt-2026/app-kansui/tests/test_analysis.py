import unittest

import helpers  # noqa: F401
from kansui import analysis as A

LAT, LON = 35.680, 139.780
DLAT_100M = 0.0009


def st(osm, name, lat, lon, op="東京都交通局", kind="subway"):
    return {"osm": osm, "name": name, "lat": lat, "lon": lon, "operator": op, "ref": "", "kind": kind}


def en(osm, ref, lat, lon, name=""):
    return {"osm": osm, "name": name, "ref": ref, "lat": lat, "lon": lon, "wheelchair": ""}


STATIONS = [
    st("s1", "甲", LAT, LON),
    st("s1b", "甲", LAT + 0.0002, LON, op="東京地下鉄"),     # 同名・近い → 統合
    st("s2", "乙", LAT + 8 * DLAT_100M, LON),                # 約800m北
    st("s3", "丙", LAT + 40 * DLAT_100M, LON),               # 約4km北（遠い）
]
ENTS = [
    en("e1", "A1", LAT + DLAT_100M, LON),                    # 甲: 深い
    en("e2", "A2", LAT - DLAT_100M, LON),                    # 甲: 浅い
    en("e3", "A3", LAT, LON + 2 * DLAT_100M),                # 甲: 着色なし
    en("e4", "B1", LAT + 8 * DLAT_100M, LON),                # 乙: 区分1
    en("e5", "C1", LAT + 40 * DLAT_100M, LON),               # 丙: 0
    en("e6", "", LAT + 100 * DLAT_100M, LON + 0.3),          # どの駅からも遠い
]
HZ = {"e1": (4, 0), "e2": (2, 3), "e3": (0, 0), "e4": (1, 0), "e5": (0, 0)}


def make_sampler():
    by_pos = {}
    for e in ENTS:
        by_pos[(round(e["lon"], 6), round(e["lat"], 6))] = HZ.get(e["osm"], (0, 0))

    def sampler(lon, lat):
        f, t = by_pos.get((round(lon, 6), round(lat, 6)), (0, 0))
        return {"flood": f, "tide": t}
    return sampler


BUS = [
    {"id": "b1", "name": "近い停留所", "lat": LAT + DLAT_100M, "lon": LON + 0.0005, "wd": 10, "hol": 5, "first": "06:00", "last": "22:00", "hourly": [0] * 24, "routes": ["都01"]},
    {"id": "b2", "name": "便なし", "lat": LAT, "lon": LON + 0.0005, "wd": 0, "hol": 0, "first": None, "last": None, "hourly": [0] * 24, "routes": []},
    {"id": "b3", "name": "遠い", "lat": LAT + 0.02, "lon": LON, "wd": 3, "hol": 3, "first": "07:00", "last": "20:00", "hourly": [0] * 24, "routes": []},
]


class AnalysisTest(unittest.TestCase):
    def setUp(self):
        self.ds = A.build_dataset(STATIONS, ENTS, BUS, make_sampler())
        self.st = {s["name"]: s for s in self.ds["stations"]}

    def test_same_name_stations_merged(self):
        self.assertEqual(len(self.ds["stations"]), 3)
        self.assertEqual(self.st["甲"]["operators"], ["東京地下鉄", "東京都交通局"])

    def test_assignment_and_unassigned(self):
        self.assertEqual([len(self.st[n]["entrances"]) for n in ("甲", "乙", "丙")], [3, 1, 1])
        self.assertEqual(self.ds["unassigned_entrances"], 1)

    def test_cls_is_max_of_flood_and_tide(self):
        e = {x["ref"]: x for x in self.st["甲"]["entrances"]}
        self.assertEqual(e["A1"]["cls"], 4)
        self.assertEqual(e["A2"]["cls"], 3)   # 洪水2・高潮3 の大きい方
        self.assertEqual((e["A2"]["flood"], e["A2"]["tide"]), (2, 3))
        self.assertEqual(e["A3"]["cls"], 0)

    def test_status_thresholds(self):
        self.assertEqual([A.status_of(c) for c in range(0, 7)], ["none", "warn", "avoid", "avoid", "avoid", "avoid", "avoid"])

    def test_summary(self):
        m = self.st["甲"]["summary"]
        self.assertEqual((m["n"], m["avoid"], m["warn"], m["none"], m["max"]), (3, 2, 0, 1, 4))
        self.assertEqual(self.st["乙"]["summary"]["warn"], 1)

    def test_same_station_alternatives(self):
        e = {x["ref"]: x for x in self.st["甲"]["entrances"]}
        names = [self.st["甲"]["entrances"][a["i"]]["ref"] for a in e["A1"]["alt"]["same"]]
        self.assertEqual(names, ["A3", "A2"])               # 区分の低い順
        self.assertTrue(all(a["d"] > 0 for a in e["A1"]["alt"]["same"]))
        # 一番低い出入口には、同じ駅内の代わりが無い
        self.assertEqual(e["A3"]["alt"]["same"], [])
        # 区分が同じかそれより高い出入口は候補に入らない
        self.assertNotIn("A1", [self.st["甲"]["entrances"][a["i"]]["ref"] for a in e["A2"]["alt"]["same"]])

    def test_neighbor_station_alternatives(self):
        e = {x["ref"]: x for x in self.st["甲"]["entrances"]}
        alts = e["A1"]["alt"]["stations"]
        names = [self.ds["stations"][a["s"]]["name"] for a in alts]
        self.assertEqual(names, ["乙"])                     # 丙は 1.5km より遠い
        self.assertGreater(alts[0]["d"], 600)
        self.assertLess(alts[0]["d"], 1000)

    def test_bus_alternatives_filter_and_sort(self):
        e = {x["ref"]: x for x in self.st["甲"]["entrances"]}
        bus = e["A1"]["alt"]["bus"]
        names = [self.ds["bus"][b["b"]]["name"] for b in bus]
        self.assertEqual(names, ["近い停留所"])             # 便なし・500m超は除く

    def test_unflagged_entrance_has_no_alternatives_except_bus(self):
        e = {x["ref"]: x for x in self.st["甲"]["entrances"]}["A3"]
        self.assertEqual((e["alt"]["same"], e["alt"]["stations"]), ([], []))

    def test_rank(self):
        order = [s["name"] for s in A.rank_stations(self.ds["stations"])]
        self.assertEqual(order, ["甲", "乙", "丙"])

    def test_station_without_entrances_uses_station_point(self):
        ds = A.build_dataset([st("s9", "孤", LAT, LON)], [], [], lambda lo, la: {"flood": 2, "tide": 0})
        s = ds["stations"][0]
        self.assertEqual(s["summary"], {"n": 0, "avoid": 0, "warn": 0, "none": 0, "max": None})
        self.assertEqual(s["cls"], 2)
        self.assertEqual(A.rank_stations(ds["stations"]), [])

    def test_name_match_wins_over_nearest(self):
        groups = A.group_stations([st("a", "蔵前", LAT, LON), st("b", "浅草橋", LAT + 2 * DLAT_100M, LON)])
        by, un = A.assign_entrances(groups, [en("x", "1", LAT + 2 * DLAT_100M, LON, name="蔵前駅")])
        self.assertEqual({g["name"]: len(b) for g, b in zip(groups, by)}, {"蔵前": 1, "浅草橋": 0})
        self.assertEqual(un, [])


if __name__ == "__main__":
    unittest.main()
