"""アグレッサー（2026-11-09）による失敗テスト。壊れる入力・誤解を招く診断を記録する。

本体は修正しない方針のため、現時点で落ちるものは @known_bug を付けて「既知の失敗」として扱う
（通常の `python3 -m unittest` は緑のまま。修正されると unexpected success として知らせる）。
赤で見たいときは環境変数 AGGRESSOR_STRICT=1 を付けて実行する:

    AGGRESSOR_STRICT=1 python3 -m unittest tests.test_aggressor -v

報告: reports/aggressor/odpt-2026-20261109.md
"""
import csv
import datetime as dt
import io
import json
import os
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from helpers import csv_bytes, make_feed_zip, make_geojson_zip, make_mesh_zip
from lifemap import access, build, gtfs, sources
from lifemap.network import Network

STRICT = os.environ.get("AGGRESSOR_STRICT") == "1"
BBOX = [130.0, 30.0, 140.0, 40.0]
TODAY = dt.date(2026, 11, 9)   # 月曜
CAL_HEAD = ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "start_date", "end_date"]
CAL_ALL = [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"), ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]


def known_bug(fn):
    """現行実装で落ちる（=弱点）テスト。STRICT では普通のテストとして赤くなる。"""
    return fn if STRICT else unittest.expectedFailure(fn)


def raw_zip(files):
    """{ファイル名: 行のリスト or bytes} -> zip バイト列（GTFSの必須ファイルを任意に欠かせる）。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, body in files.items():
            z.writestr(name, body if isinstance(body, (bytes, bytearray)) else csv_bytes(body))
    return buf.getvalue()


STOPS = [["stop_id", "stop_name", "stop_lat", "stop_lon"], ["a", "甲", "35.0", "135.0"], ["b", "乙", "35.01", "135.0"]]
ROUTES = [["route_id", "route_short_name", "route_long_name", "route_color"], ["r1", "1", "A線", ""]]
TRIPS = [["route_id", "service_id", "trip_id", "direction_id"], ["r1", "wk", "t1", "0"], ["r1", "ho", "t2", "0"]]
STOP_TIMES = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
              ["t1", "08:00:00", "08:00:00", "a", "1"], ["t1", "08:10:00", "08:10:00", "b", "2"],
              ["t2", "12:00:00", "12:00:00", "a", "1"], ["t2", "12:10:00", "12:10:00", "b", "2"]]


# ---------------------------------------------------------------------------
# 1. GTFS の壊れた・珍しい入力
# ---------------------------------------------------------------------------
class TestGtfsEdgeInputs(unittest.TestCase):
    def test_empty_calendar_with_calendar_dates_only(self):
        """calendar.txt がヘッダーのみ、運行日は calendar_dates だけで指定（GTFS-JP で実在する形）。"""
        cd = [["service_id", "date", "exception_type"], ["wk", "20261111", "1"], ["ho", "20261115", "1"]]
        z = raw_zip({"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES,
                     "calendar.txt": [CAL_HEAD], "calendar_dates.txt": cd})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual(fd["ref"]["wd"], dt.date(2026, 11, 11))
        self.assertEqual(len(fd["trips"]), 2)

    def test_calendar_dates_only_feed_without_calendar_file(self):
        """calendar.txt 自体が無い（GTFS 仕様上は許される）。"""
        cd = [["service_id", "date", "exception_type"]]
        d = dt.date(2026, 11, 1)
        while d <= dt.date(2026, 12, 31):   # 2か月分の平日・休日を列挙
            cd.append(["wk" if d.weekday() < 5 else "ho", d.strftime("%Y%m%d"), "1"])
            d += dt.timedelta(days=1)
        z = raw_zip({"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES,
                     "calendar_dates.txt": cd})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual({t["trip_id"] for t in fd["trips"]}, {"t1", "t2"})

    def test_times_beyond_24h(self):
        """24時超（翌1:10着）の便。秒への変換・終発表示（翌）を確認。"""
        trips = [("n1", "r1", "wk", "0", [("a", "24:40:00", "24:40:00"), ("b", "25:10:00", "25:10:00")])]
        z = make_feed_zip([("a", "甲", 35.0, 135.0), ("b", "乙", 35.01, 135.0)], [("r1", "1", "深夜")], trips, CAL_ALL)
        fd = gtfs.load_feed(z, BBOX, TODAY)
        net = Network([fd], [("o", "f")])
        cnt, first, last, _ = net.node_stats("wd")
        a = next(i for i, n in enumerate(net.nodes) if n[2] == "甲")
        self.assertEqual(last[a], 24 * 3600 + 40 * 60)
        self.assertEqual(cnt[a][3], 1)

    def test_previous_day_after_midnight_trip_is_ignored(self):
        """火曜の 25:30 発（=水曜 1:30）の便は水曜の診断に入らない。朝8時診断には影響しないことの記録。"""
        trips = [("n1", "r1", "wk", "0", [("a", "25:30:00", "25:30:00"), ("b", "25:40:00", "25:40:00")])]
        z = make_feed_zip([("a", "甲", 35.0, 135.0), ("b", "乙", 35.01, 135.0)], [("r1", "1", "深夜")], trips, CAL_ALL)
        fd = gtfs.load_feed(z, BBOX, TODAY)
        # 水曜の便として 25:30 で読まれる（前日分の扱いではない）。8/12/17時の診断には関与しない。
        self.assertEqual(fd["trips"][0]["seq"][0][1], 25 * 3600 + 30 * 60)

    def test_missing_coordinates_does_not_crash(self):
        """途中の停留所の座標が欠損。落ちずに、その停留所を飛ばした区間として読む。"""
        stops = [["stop_id", "stop_name", "stop_lat", "stop_lon"], ["a", "甲", "35.0", "135.0"],
                 ["m", "欠損", "", ""], ["b", "乙", "35.01", "135.0"]]
        st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
              ["t1", "08:00:00", "08:00:00", "a", "1"], ["t1", "08:05:00", "08:05:00", "m", "2"],
              ["t1", "08:10:00", "08:10:00", "b", "3"]]
        z = raw_zip({"stops.txt": stops, "routes.txt": ROUTES, "trips.txt": TRIPS[:2], "stop_times.txt": st,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL]})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual([s for s, _, _ in fd["trips"][0]["seq"]], ["a", "b"])

    def test_zero_coordinates_dropped(self):
        """lat=0,lon=0（よくある入力ミス）は bbox 外として捨てられる。"""
        stops = STOPS + [["z", "ゼロ", "0", "0"]]
        z = raw_zip({"stops.txt": stops, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL]})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertNotIn("z", fd["stops"])

    @known_bug
    def test_duplicate_stop_id_is_detected(self):
        """stops.txt に同じ stop_id が2行（座標が別）。現状は後勝ちで黙って上書きし、警告も出さない。
        期待: 重複を検出して記録する（少なくとも最初の行を採るか、ビルドで警告する）。"""
        stops = STOPS + [["a", "甲（別地点）", "35.5", "135.5"]]
        z = raw_zip({"stops.txt": stops, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL]})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual(fd["stops"]["a"][:2], (35.0, 135.0))   # 現状は (35.5, 135.5) になる

    @known_bug
    def test_frequencies_txt_is_expanded(self):
        """frequencies.txt（7:00〜9:00 を10分間隔）。現状は無視され、テンプレートの1便だけになる。
        → 本数・到達とも過小評価。GTFS-JP の一部（路面電車・循環バス）で使われる。"""
        freq = [["trip_id", "start_time", "end_time", "headway_secs", "exact_times"],
                ["t1", "07:00:00", "09:00:00", "600", "1"]]
        st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
              ["t1", "00:00:00", "00:00:00", "a", "1"], ["t1", "00:10:00", "00:10:00", "b", "2"]]
        z = raw_zip({"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS[:2], "stop_times.txt": st,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL], "frequencies.txt": freq})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual(len(fd["trips"]), 12)   # 7:00, 7:10, …, 8:50（end_time は含まない）

    @known_bug
    def test_cp932_encoded_feed_fails_gracefully(self):
        """Shift_JIS(cp932) の GTFS。現状は UnicodeDecodeError でビルド全体が止まる。
        期待: そのフィードを飛ばして警告する、または cp932 を試す。"""
        def cp932(rows):
            return csv_bytes(rows).decode("utf-8").encode("cp932")
        z = raw_zip({"stops.txt": cp932(STOPS), "routes.txt": cp932(ROUTES), "trips.txt": TRIPS,
                     "stop_times.txt": STOP_TIMES, "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL]})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual(fd["stops"]["a"][2], "甲")

    @known_bug
    def test_missing_service_id_column_fails_gracefully(self):
        """trips.txt の service_id 列が無い（壊れたフィード）。現状は KeyError で全地域のビルドが止まる。"""
        trips = [["route_id", "trip_id"], ["r1", "t1"]]
        z = raw_zip({"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": trips, "stop_times.txt": STOP_TIMES,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL]})
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertEqual(fd["trips"], [])

    @known_bug
    def test_ref_date_stays_inside_short_feed_period(self):
        """有効期間が木〜土の3日間（水曜を含まない）。現状は期間外の水曜(前日)を返し、平日便ゼロになる。"""
        d = gtfs.pick_ref_date(TODAY, dt.date(2026, 11, 12), dt.date(2026, 11, 14), 2)
        self.assertTrue(dt.date(2026, 11, 12) <= d <= dt.date(2026, 11, 14), d)

    @known_bug
    def test_weekday_ref_avoids_exception_day(self):
        """年末に作り直すと（--today 2026-12-28）基準の水曜が 12/30 になる。事業者が calendar_dates で
        平日ダイヤを運休にしている日でも、そのまま「平日」として診断してしまう（平日0便＝全域赤）。
        期待: 例外日（exception_type=2 で平日ダイヤが消える日）を避けて次の水曜を選ぶ。"""
        cd = [["service_id", "date", "exception_type"], ["wk", "20261230", "2"], ["ho", "20261230", "1"]]
        z = raw_zip({"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES,
                     "calendar.txt": [CAL_HEAD] + [list(c) for c in CAL_ALL], "calendar_dates.txt": cd})
        fd = gtfs.load_feed(z, BBOX, dt.date(2026, 12, 28))
        wd_trips = [t["trip_id"] for t in fd["trips"] if t["active"]["wd"]]
        self.assertEqual(wd_trips, ["t1"])   # 現状は ["t2"]（休日ダイヤが平日として入る）

    def test_expired_feed_is_flagged(self):
        """有効期間が切れたフィード（today > end）。現状は期間内の最後の水曜を黙って使い、
        出力にも「期限切れ」の印が無い。審査時点（2027/1〜2）に古いダイヤで診断している恐れ。"""
        z = make_feed_zip([("a", "甲", 35.0, 135.0), ("b", "乙", 35.01, 135.0)], [("r1", "1", "A線")],
                          [("t1", "r1", "wk", "0", [("a", "08:00:00", "08:00:00"), ("b", "08:10:00", "08:10:00")])],
                          [("wk", 1, 1, 1, 1, 1, 0, 0, "20260401", "20261031")], feed_info=("20260401", "20261031"))
        fd = gtfs.load_feed(z, BBOX, TODAY)
        self.assertTrue(fd.get("expired"), "期限切れの印が無い: ref=%s" % fd["ref"])


# ---------------------------------------------------------------------------
# 2. 診断ロジック: 表示と定義の食い違い
# ---------------------------------------------------------------------------
def _diag(cells_latlon, facilities, feeds=()):
    net = Network(list(feeds), [("o%d" % i, "f") for i in range(len(feeds))]) if feeds else _empty_net()
    cells = [("c%d" % i, la, lo, 100, 30) for i, (la, lo) in enumerate(cells_latlon)]
    return access.diagnose_cells(net, cells, {"hospital": facilities}, types=["hospital"])


def _empty_net():
    return Network([], [])


class TestDiagnosisSemantics(unittest.TestCase):
    def test_walk_1km_counts_as_reachable_within_20min(self):
        """施設まで直線1.0km（アプリ自身の徒歩モデルで 1000×1.25/80 = 15.6分）、バスなし。
        徒歩だけで行けるかの判定は徒歩モデルと許容時間に一致させた（修正済み。以前は直線800m固定で「到達できない（赤）」だった）。"""
        lv, walk, _ = _diag([(35.0, 135.0)], [(35.0 + 1000 / 110574.0, 135.0)])
        reachable = int(walk["c0"][0]) >= 4 or int(lv["c0"][0]) >= 4   # W=20 は水準4
        self.assertTrue(reachable, "徒歩15.6分の地点が20分以内に到達できない扱い")

    def test_walk_only_threshold_boundary(self):
        """徒歩だけの判定の境界を固定。20分=直線1280m（×1.25÷分速80m）。1279mは水準4（20分以内）、1281mは水準3（30分以内）。
        3840mは60分ちょうど（水準1）、3841mは歩いても60分以内に着けない（水準0）。"""
        pts = [(35.0, 135.0), (36.0, 135.0), (37.0, 135.0), (38.0, 135.0)]
        facs = [(la + d / 110574.0, 135.0) for (la, _), d in zip(pts, (1279, 1281, 3839, 3841))]
        _, walk, _ = _diag(pts, facs[:1])   # 施設は1つだけ。他の点は遠いので0になることも確認
        self.assertEqual(walk["c0"], "4")
        for i, (la, d) in enumerate(zip((36.0, 37.0, 38.0), (1281, 3839, 3841))):
            _, w, _ = _diag([(la, 135.0)], [(la + d / 110574.0, 135.0)])
            self.assertEqual(w["c0"], {1281: "3", 3839: "1", 3841: "0"}[d], d)

    def test_no_facilities_in_region(self):
        """bbox 内に病院が1つも無い（中山間地で起こりうる）。落ちずに全セル水準0。"""
        z = make_feed_zip([("a", "甲", 35.0, 135.0), ("b", "乙", 35.01, 135.0)], [("r1", "1", "A線")],
                          [("t1", "r1", "wk", "0", [("a", "08:00:00", "08:00:00"), ("b", "08:10:00", "08:10:00")])], CAL_ALL)
        fd = gtfs.load_feed(z, BBOX, TODAY)
        lv, walk, _ = _diag([(35.0, 135.0)], [], feeds=[fd])
        self.assertEqual(lv["c0"], "000000")
        self.assertEqual(walk["c0"], "0")

    @known_bug
    def test_walking_transfer_between_unmerged_stops(self):
        """別名・60m離れた停留所（例: 市電「熊本駅前」とバス「熊本駅」）。40m超かつ別名なので統合されず、
        徒歩乗継が一切できない。期待: 数百m以内の徒歩乗継を許す（または統合条件を見直す）。"""
        k = 1 / 110574.0
        stops1 = [("a", "甲", 35.0, 135.0), ("x", "駅前", 35.0 + 3000 * k, 135.0)]
        stops2 = [("y", "駅", 35.0 + 3060 * k, 135.0), ("h", "病院前", 35.0 + 6000 * k, 135.0)]
        f1 = gtfs.load_feed(make_feed_zip(stops1, [("r1", "1", "A")],
                                          [("t1", "r1", "wk", "0", [("a", "08:05:00", "08:05:00"), ("x", "08:12:00", "08:12:00")])],
                                          CAL_ALL), BBOX, TODAY)
        f2 = gtfs.load_feed(make_feed_zip(stops2, [("r2", "2", "B")],
                                          [("t2", "r2", "wk", "0", [("y", "08:20:00", "08:20:00"), ("h", "08:27:00", "08:27:00")])],
                                          CAL_ALL), BBOX, TODAY)
        lv, _, _ = _diag([(35.0, 135.0)], [(35.0 + 6000 * k, 135.0)], feeds=[f1, f2])
        self.assertGreaterEqual(int(lv["c0"][0]), 3, "60m の徒歩乗継ができず、到達不可になる")


# ---------------------------------------------------------------------------
# 3. 前処理の通し: 空データ
# ---------------------------------------------------------------------------
class TestBuildEmpty(unittest.TestCase):
    def _paths(self, d, feed_zip):
        la0, lo0, la1, lo1 = sources.mesh_bounds("53394611")
        (d / "feed.zip").write_bytes(feed_zip)
        (d / "mesh.zip").write_bytes(make_mesh_zip([("5339461111", 60, 20)]))
        (d / "p04.zip").write_bytes(make_geojson_zip([]))
        (d / "p29.zip").write_bytes(make_geojson_zip([]))
        (d / "feeds.json").write_text(json.dumps({"body": []}), encoding="utf-8")
        paths = {"feed": {("o", "f"): d / "feed.zip"}, "mesh": {"5339": d / "mesh.zip"},
                 "p04": {"99": d / "p04.zip"}, "p29": {"99": d / "p29.zip"}, "feeds_json": d / "feeds.json"}
        reg = {"id": "t", "name": "試験", "pref": "99", "bbox": [lo0 - 0.05, la0 - 0.05, lo1 + 0.05, la1 + 0.05],
               "reason": "試験", "feeds": [["o", "f"]]}
        return paths, reg

    @known_bug
    def test_region_with_no_active_trips(self):
        """全フィードが基準日に運行なし（期限切れ・calendar 空など）。現状は center 計算で
        ZeroDivisionError となりビルドが止まる。期待: 空の地域として出力するか、明確なエラーを出す。"""
        la0, lo0, _, _ = sources.mesh_bounds("53394611")
        z = make_feed_zip([("a", "甲", la0, lo0), ("b", "乙", la0 + 0.01, lo0)], [("r1", "1", "A線")],
                          [("t1", "r1", "zz", "0", [("a", "08:00:00", "08:00:00"), ("b", "08:10:00", "08:10:00")])],
                          [("zz", 0, 0, 0, 0, 0, 0, 0, "20261101", "20271031")])
        with tempfile.TemporaryDirectory() as t:
            paths, reg = self._paths(Path(t), z)
            out = build.build_region(reg, paths, build.feed_meta_index(paths["feeds_json"]), TODAY)
            self.assertEqual(out["cells"], [])

    @known_bug
    def test_feed_missing_from_repository_index_keeps_license(self):
        """feeds.json（リポジトリ一覧）にそのフィードが無い場合、ライセンス欄が空文字で出力される。
        期待: ライセンス不明のフィードはビルドを止める（出典表示の欠落は規約違反になりうる）。"""
        la0, lo0, _, _ = sources.mesh_bounds("53394611")
        z = make_feed_zip([("a", "甲", la0, lo0), ("b", "乙", la0 + 0.01, lo0)], [("r1", "1", "A線")],
                          [("t1", "r1", "wk", "0", [("a", "08:00:00", "08:00:00"), ("b", "08:10:00", "08:10:00")])], CAL_ALL)
        with tempfile.TemporaryDirectory() as t:
            paths, reg = self._paths(Path(t), z)
            try:
                out = build.build_region(reg, paths, build.feed_meta_index(paths["feeds_json"]), TODAY)
            except Exception:   # noqa: BLE001 - 止まるのが期待
                return
            self.assertNotEqual(out["feeds"][0]["license"], "", "ライセンス不明のまま出力された")


# ---------------------------------------------------------------------------
# 4. 生成済みデータ（web/data）に対する審査目線の検査
# ---------------------------------------------------------------------------
DATA = Path(__file__).resolve().parent.parent / "web" / "data"


@unittest.skipUnless((DATA / "index.json").exists(), "生成データなし")
class TestGeneratedDataForJudges(unittest.TestCase):
    def regions(self):
        return [r["id"] for r in json.loads((DATA / "index.json").read_text(encoding="utf-8"))["regions"]]

    @known_bug
    def test_feeds_valid_through_award_ceremony(self):
        """表彰式 2027-02-20／公開義務 2027-03-12 まで全フィードが有効期間内か。
        現状: 熊本の4フィードが 2027-02-10〜12、飯田(喬木村)が 2027-01-29 に失効。審査期間中に画面の
        「データ有効期間」が過去日になる。"""
        bad = []
        for rid in self.regions():
            d = json.loads((DATA / f"{rid}.json").read_text(encoding="utf-8"))
            for f in d["feeds"]:
                if f["valid"][1] and f["valid"][1] < "2027-03-12":
                    bad.append((rid, f["id"], f["valid"][1]))
        self.assertEqual(bad, [])

    def test_whatif_route_labels_are_distinguishable(self):
        """「路線を止めたら？」の選択肢で、同じ表示名・同じ事業者の路線が複数ある（GTFS の route_id が
        方向・系統ごとに分かれている）。利用者には区別できず、片方を止めても他方が残るため影響が過小に出る。
        現状: 富山 272路線中 表示名の重複 51組、熊本 7組、飯田 3組。"""
        dup = {}
        for rid in self.regions():
            d = json.loads((DATA / f"{rid}.json").read_text(encoding="utf-8"))
            seen = {}
            for r in d["routes"]:
                key = (r[0], r[1], r[2])
                seen[key] = seen.get(key, 0) + 1
            n = sum(1 for v in seen.values() if v > 1)
            if n:
                dup[rid] = n
        self.assertEqual(dup, {})

    def test_red_cells_are_not_walkable(self):
        """「行けない（赤）」の人口のうち、アプリ自身の徒歩モデル（直線×1.25÷80m/分）で
        許容時間内に歩いて着ける人口が 10% 未満であること（修正済み。以前は多くの条件で 50〜99%）。"""
        import math
        worst = []
        for rid in self.regions():
            d = json.loads((DATA / f"{rid}.json").read_text(encoding="utf-8"))
            fac = d["facilities"]["hospital"]
            red = walkable = 0
            for c in d["cells"]:
                if int(c[4][0]) >= 1 or int(c[3][0]) >= 1:   # 病院・平日朝・60分（歩いても公共交通でも着ける）
                    continue
                red += c[1]
                a, b, cc, dd = sources.mesh_bounds(c[0])
                lat, lon = (a + cc) / 2, (b + dd) / 2
                kx = 111320 * math.cos(math.radians(lat))
                m = min(math.hypot((lon - f[0]) * kx, (lat - f[1]) * 110574) for f in fac) if fac else 1e9
                if m * 1.25 / 80 <= 60:
                    walkable += c[1]
            if red and walkable / red >= 0.10:
                worst.append((rid, round(100 * walkable / red)))
        self.assertEqual(worst, [], "赤のうち歩けば60分以内の割合(%)")


# ---------------------------------------------------------------------------
# 5. 規模: 極端に大きいフィード（既定ではスキップ。AGGRESSOR_LARGE=1 で実行）
# ---------------------------------------------------------------------------
@unittest.skipUnless(os.environ.get("AGGRESSOR_LARGE") == "1", "AGGRESSOR_LARGE=1 のときのみ")
class TestLargeFeed(unittest.TestCase):
    def test_large_feed_build_time(self):
        """停留所 3000・便 6000 × 20停留所（約11万接続）・メッシュ 3000 で、診断1回が 30 秒以内。
        参考: 路線除外の再計算は路線数ぶん繰り返すため、実時間はこの値 × 路線数になる。"""
        import random
        rnd = random.Random(1)
        stops = [("s%d" % i, "停%d" % i, 35.0 + rnd.random() * 0.3, 135.0 + rnd.random() * 0.3) for i in range(3000)]
        trips = []
        for t in range(6000):
            seq = rnd.sample(range(3000), 20)
            h = 6 * 3600 + rnd.randrange(14 * 3600)
            st = []
            for k, s in enumerate(seq):
                tt = h + k * 120
                hh = "%02d:%02d:%02d" % (tt // 3600, tt % 3600 // 60, tt % 60)
                st.append(("s%d" % s, hh, hh))
            trips.append(("t%d" % t, "r%d" % (t % 200), "wk" if t % 3 else "ho", "0", st))
        z = make_feed_zip(stops, [("r%d" % i, str(i), "") for i in range(200)], trips, CAL_ALL)
        t0 = time.time()
        fd = gtfs.load_feed(z, BBOX, TODAY)
        net = Network([fd], [("o", "f")])
        cells = [("c%d" % i, 35.0 + rnd.random() * 0.3, 135.0 + rnd.random() * 0.3, 10, 3) for i in range(3000)]
        fac = [(35.0 + rnd.random() * 0.3, 135.0 + rnd.random() * 0.3) for _ in range(30)]
        access.diagnose_cells(net, cells, {"hospital": fac, "school": fac})
        el = time.time() - t0
        print("large feed: %.1fs, routes=200 → whatif 概算 %.0f 分" % (el, el * 200 / 60))
        self.assertLess(el, 30)


# ---------------------------------------------------------------------------
# 6. フロントの純粋関数（node があるときのみ）
# ---------------------------------------------------------------------------
import shutil  # noqa: E402
import subprocess  # noqa: E402


@unittest.skipUnless(shutil.which("node"), "node なし")
class TestLibJsEdges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        js = Path(__file__).resolve().parent / "aggressor_lib_test.js"
        r = subprocess.run(["node", str(js)], capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, r.stderr
        cls.res = json.loads(r.stdout.strip().splitlines()[-1])

    def test_click_maps_to_same_cell(self):
        """全セルの中心・四隅近傍で meshCodeAt が元のコードに戻る（地点クリックの取り違えがない）。"""
        self.assertEqual(self.res["meshRoundTrip"]["mismatch"], [])

    def test_empty_summary_is_zero_not_nan(self):
        self.assertEqual(self.res["emptySummary"], {"pop": 0, "pct": 0})

    @known_bug
    def test_missing_level_is_not_shown_as_unreachable(self):
        """診断文字列が欠けた（データなし）セルを「到達できない」と表示してしまう。期待: 'nodata' 等で区別。"""
        self.assertNotEqual(self.res["missingDigitStatus"], "none")

    @known_bug
    def test_fmt_min_two_days(self):
        """48時超（2900分=翌々0:20）が「翌0:20」になる（実データでは起きにくい・軽微）。"""
        self.assertNotEqual(self.res["fmt2days"], "翌0:20")


if __name__ == "__main__":
    unittest.main()
