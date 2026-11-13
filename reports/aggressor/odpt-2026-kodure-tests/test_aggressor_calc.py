"""アグレッサー（2026-11-14）: 子連れお出かけ診断の計算が誤った結果・誤解を招く結果を出す入力と状況の失敗テスト。

配置先: contests/odpt-2026/app-kodure/tests/test_aggressor_calc.py（書き込みガードによりアグレッサーは直接置けないため、
ここに置いた。工兵か参謀長がコピーする）。コピーせずに実行する場合:
  cd contests/odpt-2026/app-kodure && PYTHONPATH=tests python3 <このファイル>

「直っていれば通る」ように書いてある。現時点で落ちるものは落ちたまま残す
（一覧と理由は reports/aggressor/odpt-2026-kodure-20261114.md）。アプリ本体は変更していない。
"""
import datetime as dt
import json
import unittest

import kh
from kodure import build as kb
from kodure import dests as dests_mod
from kodure import router as rt
from lifemap.network import dist_m

DATA = kh.ROOT / "web" / "data"
META = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
NC = len(META["cells"])
CACHE = kh.ROOT / "cache"


def load(name):
    return [kb.rle_decode(s, NC) for s in json.loads((DATA / name).read_text(encoding="utf-8"))]


def secs(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


class TestWalkingTransferBetweenStops(unittest.TestCase):
    """乗継は「同じ停留所群（名称が違えば40m以内、同名なら150m以内）」の中だけで、別の停留所へ歩いて乗り継げない。
    実在の乗換駅（浅草・押上・大手町・日比谷・新橋・春日/後楽園など）がこの条件で分かれている（報告書 W1）。"""

    def test_transfer_to_stop_100m_away(self):
        # A線の終点 A と、名称の違う B線の始発 B が約100m離れている。A で降りて B まで歩けば10:20の便に乗れる。
        stops = [("s0", "出発", 35.500, 139.500), ("a", "A駅", 35.510, 139.500),
                 ("b", "B停留所", 35.5109, 139.500), ("t", "到着", 35.530, 139.500)]
        trips = [("t1", "r1", "ho", 0, [("s0", "10:00:00", "10:00:00"), ("a", "10:10:00", "10:10:00")]),
                 ("t2", "r2", "ho", 0, [("b", "10:20:00", "10:20:00"), ("t", "10:30:00", "10:30:00")])]
        net = kh.make_network(stops, trips, routes=(("r1", "1", "A線"), ("r2", "2", "B線")))
        self.assertEqual(net.n, 4, "A と B は別の停留所群（約100m・名称が違う）")
        node = {name: i for i, (_la, _lo, name) in enumerate(net.nodes)}
        r = rt.Router(net)
        t0 = secs("10:00:00")
        _a1, a2, _a3 = r.scan({node["出発"]: t0}, t0)
        self.assertEqual(a2[node["到着"]], secs("10:30:00"),
                         "約100m先の別の停留所へ歩いて乗り継ぐ経路が無い（乗換1回までなのに着けない扱い）")


@unittest.skipUnless((CACHE / "feed" / "odpt__tokyometro-train.zip").exists(), "取得済みのGTFS（cache/）が無い")
class TestRealNetwork(unittest.TestCase):
    """取得済みの実データで、主要な乗換駅の分断と、出発時刻の位相への過敏さを確かめる（約30秒）。"""

    @classmethod
    def setUpClass(cls):
        from lifemap import build as lm_build, fetch
        from lifemap.gtfs import load_feed
        from lifemap.network import Network
        reg = next(r for r in json.loads((kb.APP / "regions.json").read_text(encoding="utf-8"))["regions"] if r["id"] == "tokyo")
        paths = kb.fetch_inputs(reg, CACHE)
        defs = lm_build.loaded_feed_defs(reg, paths)
        keys = [fetch.feed_key(f) for f in defs]
        feeds = [load_feed(paths["feed"][k], reg["bbox"], dt.date.fromisoformat(META["built"])) for k in keys]
        cls.net = Network(feeds, keys)
        cls.feeds_at = [set() for _ in range(cls.net.n)]
        for ridx, seq, _d in cls.net.trips["hol"]:
            for nd, _a, _b in seq:
                cls.feeds_at[nd].add(keys[cls.net.routes[ridx][0]][1])

    def _rail_nodes(self, name):
        rail = {"toei-train", "tokyometro-train", "twr-train", "mir-train"}
        return [i for i, n in enumerate(self.net.nodes) if n[2] == name and self.feeds_at[i] & rail]

    def test_same_name_rail_stations_are_connected(self):
        """同名の地下鉄駅（浅草=銀座線と浅草線、押上、日比谷、大手町、飯田橋、西日暮里、東新宿など）が別ノードで、歩いて乗り継げない。"""
        split = []
        for name in ("浅草", "押上", "日比谷", "大手町", "飯田橋", "西日暮里", "東新宿", "四ツ谷", "溜池山王", "霞ケ関"):
            ids = self._rail_nodes(name)
            if len(ids) > 1:
                split.append((name, len(ids)))
        self.assertEqual(split, [], "同名の駅が乗り継げない別ノードに分かれている: %s" % split)

    def test_asakusa_transfer_metro_to_toei(self):
        """銀座線の浅草から都営浅草線の浅草（約230m）へ、乗換1回までで15分以内に移れること。"""
        ids = self._rail_nodes("浅草")
        metro = [i for i in ids if "tokyometro-train" in self.feeds_at[i]]
        toei = [i for i in ids if "toei-train" in self.feeds_at[i]]
        if not metro or not toei:
            self.skipTest("浅草の駅ノードが見つからない（データ更新で名称が変わった）")
        r = rt.Router(self.net)
        t0 = 10 * 3600
        _a1, a2, _a3 = r.scan({metro[0]: t0}, t0)
        got = a2[toei[0]] - t0 if a2[toei[0]] < rt.INF else None
        self.assertTrue(got is not None and got <= 15 * 60,
                        "浅草で銀座線→浅草線に乗り継げず、遠回りでしか着かない（%s）" % ("%d秒" % got if got is not None else "到達不能"))

    def test_large_parks_have_stop_within_cap(self):
        """10ha以上の公園の中心点から直線800m以内に収録停留所が1つも無く、徒歩800m・乗換制限なしでも、
        歩いて着ける近所の地区を除けば公共交通では「どこからも行けない」ものがある（駒沢・砧・水元・篠崎・城北中央など）。
        画面ではその公園を選ぶと大半がオレンジ（行けない）になり、利用者には「停留所が遠い」という理由が示されない。"""
        dead = [d[2] for d in META["dests"] if d[3] == "park_l"
                and not any(dist_m(d[1], d[0], n[0], n[1]) <= 800 for n in self.net.nodes)]
        self.assertEqual(dead, [], "中心点の800m以内に収録停留所が無い大きい公園: %s" % dead)

    def test_result_robust_to_5min_departure_shift(self):
        """「9:00ちょうど発」の1点で判定しているため、5分ずらすだけで行ける/行けないが大量に入れ替わる。
        実測（メッシュ1/10抽出・徒歩500m・乗換1回まで・45分）で約22%の組が入れ替わる。10%以下を合格とする
        （例えば 9:00〜9:59 の毎分の所要の中央値で判定すれば下がるはず）。"""
        from lifemap.sources import mesh_bounds
        cells = []
        for c in META["cells"][::10]:
            a, b, cc, d = mesh_bounds(c[0])
            cells.append(((a + cc) / 2, (b + d) / 2))
        dests = [(d[1], d[0]) for d in META["dests"]]
        h2 = 9 + 5 / 60
        m = kb.compute_matrices(self.net, cells, dests, caps=(500,), out_hours=(9, h2), ret_hours=(16,), workers=4)
        o9, o905 = m[("o", 9, 500, 2)], m[("o", h2, 500, 2)]
        flip = tot = 0
        lim = 45 // rt.QUANT_MIN
        for d in range(len(dests)):
            for ci in range(len(cells)):
                x, y = 0 < o9[d][ci] <= lim, 0 < o905[d][ci] <= lim
                if x or y:
                    tot += 1
                    flip += x != y
        self.assertLessEqual(flip / tot, 0.10, "9:00発と9:05発で %d/%d 組（%.1f%%）が入れ替わる" % (flip, tot, 100 * flip / tot))


class TestDestinations(unittest.TestCase):
    def test_closed_facilities_not_listed(self):
        """P27（2013年度版）由来で、閉館済みの施設が行き先に残っている（逓信総合博物館は2013年8月に閉館し、郵政博物館として移転）。"""
        names = {d[2] for d in META["dests"]}
        self.assertNotIn("逓信総合博物館", names)

    def test_park_names_recognizable(self):
        """P13 の名称に「公園」等が付かないものがそのまま一覧に出る（例: 「深川」「豊洲」「南砂三丁目」）。利用者が公園と分からない。"""
        suffix = ("公園", "緑地", "庭園", "広場", "園", "の森", "河川敷", "緑道", "ガーデン", "ランド", "親水")
        bad = [d[2] for d in META["dests"] if d[3] in ("park_l", "park_m") and not any(s in d[2] for s in suffix)]
        self.assertEqual(bad, [], "公園と分からない名称: %s" % bad)

    def test_dedupe_across_rounding_boundary(self):
        """同名・5m以内の重複でも、丸めの境界をまたぐと1つにまとまらない（round(座標/0.0003) の区切りの両側）。"""
        tol = 0.0003
        x = (463334 + 0.5) * tol      # 丸めの境界
        a = (x - 0.00002, 35.0, "同じ館", "museum", 0, "")
        b = (x + 0.00002, 35.0, "同じ館", "museum", 0, "")
        self.assertLess(dist_m(35.0, a[0], 35.0, b[0]), 5)
        self.assertEqual(len(dests_mod.dedupe([a, b])), 1)


class TestFreshness(unittest.TestCase):
    def test_feeds_valid_through_hearing(self):
        """ヒアリング（2027-01-23〜24）の時点で有効期間が切れているデータで計算している。公開前の再生成で直る想定だが、
        京王バス・西武バス・北区Kバス（〜12/31）、小田急バス（〜11/30）は次の版が出ないと直せない。"""
        hearing = "2027-01-24"
        ended = ["%s(〜%s)" % (f["org"], f["valid"][1]) for f in META["feeds"] if f["valid"][1] and f["valid"][1] < hearing]
        self.assertEqual(ended, [], "ヒアリング時点で期限切れ: %s" % ended)

    def test_skipped_feeds_shown_on_screen(self):
        """取得に失敗したフィードは meta.coverage.skipped_feeds に入るが、画面はそれを読まず、
        収録範囲の文言（『都営地下鉄・東京メトロ・都営バス…』）は固定のまま。トークン切れで再生成すると、黙って範囲が欠ける。"""
        app = (kh.ROOT / "web" / "app.js").read_text(encoding="utf-8")
        self.assertIn("skipped_feeds", app)


if __name__ == "__main__":
    unittest.main()
