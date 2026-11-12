"""アグレッサー（2026-11-13）による失敗テスト。バス定時性カルテ（N2）の遅れ推定・集計・公開の弱点を記録する。

置き場所: app-teiji/tests/ への書き込みが hook で拒否されたため、reports/aggressor/odpt-2026-teiji-tests/ に置いた。
工兵が app-teiji/tests/ にコピーしてもそのまま動く（APP の探し方を両対応にしてある）。

2026-11-13 に工兵が app-teiji/tests/ へコピーし、expectedFailure（known_bug）を外した。テストの内容は変えていない。
全件が通常実行（python3 -m unittest discover -s tests）で通ることを確認済み。AGGRESSOR_STRICT=1 でも同じ結果。

報告: reports/aggressor/odpt-2026-teiji-20261113.md
全て合成データ。ネットワークは使わない。
"""
import json
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_HERE = Path(__file__).resolve().parent
if (_HERE.parent / "teiji").is_dir():                      # app-teiji/tests/ に置いた場合
    APP = _HERE.parent
else:                                                      # reports/aggressor/odpt-2026-teiji-tests/ に置いた場合
    APP = _HERE.parents[2] / "contests" / "odpt-2026" / "app-teiji"
for p in (str(APP / "tests"), str(APP)):
    if p not in sys.path:
        sys.path.insert(0, p)

from helpers import BASE, DAY, LAT0, LON0, M_PER_DEG_LON, drive, hms, make_feed_zip, make_line_schedule  # noqa: E402
from teiji import aggregate, build, delay  # noqa: E402
from teiji.gtfs import load_schedule  # noqa: E402

def ll(x, y):
    """原点 (LAT0, LON0) からの東西 x m・南北 y m を緯度経度に。"""
    return (LAT0 + y / 110574.0, LON0 + x / M_PER_DEG_LON)


def path_schedule(pts, ids, run=180, start=8 * 3600):
    """任意の形の 1 便（停留所 ids を pts の位置に置く。同じ id を再登場させればループ線）。"""
    pos = {}
    for sid, (x, y) in zip(ids, pts):
        pos.setdefault(sid, ll(x, y))
    stops = [(sid, sid, pos[sid][0], pos[sid][1]) for sid in dict.fromkeys(ids)]
    seq = [(sid, hms(start + i * run), hms(start + i * run)) for i, sid in enumerate(ids)]
    z = make_feed_zip(stops, [("L", "L", "L線")], [("T1", "L", "WD", "0", seq)],
                      [("WD", 1, 1, 1, 1, 1, 0, 0, "20260101", "20271231")])
    return load_schedule(z, DAY)


def drive_path(pts, run, start, delay_s, every=30, jitter=None):
    """pts を順に一定速度（停留所間 run 秒）で走る観測。jitter(t, x, y) -> (x, y) で GPS の誤差を足せる。"""
    obs, n, t = [], len(pts), 0
    while t <= (n - 1) * run:
        i = min(int(t // run), n - 2)
        u = (t - i * run) / run
        x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u
        y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u
        if jitter:
            x, y = jitter(t, x, y)
        obs.append((BASE + start + delay_s + t,) + ll(x, y))
        t += every
    return obs


def vrec(t, vid, trip, sdate, lat, lon, ts=None):
    return {"t": int(t) + 3, "kind": "v", "ok": True, "ft": int(t), "n": 1,
            "v": [[vid, trip, "R1", sdate, lat, lon, int(t) if ts is None else ts, None, None]]}


# ---------------------------------------------------------------- 遅れ推定（delay.py）
class TestDwellAndLayover(unittest.TestCase):
    """停車中（始発での待機・途中の停留所での時間調整）の扱い。実データでは必ず起きる。"""

    def setUp(self):
        self.sched, _ = make_line_schedule(n_stops=6, starts=(8 * 3600,), run_s=300)
        self.trip = self.sched["trips"][f"T{8 * 3600}"]

    def test_origin_layover_is_not_early_departure(self):
        # 始発停留所 S0 で 10 分待機（trip_id は次の便を出している）→ 8:00 に定刻発車。S0 の遅れは 0 のはず。
        # 現行: 最初の観測時刻を通過時刻とみなし、S0 を -600 秒（10 分早発）と推定する。
        lay = [(BASE + 8 * 3600 - 600 + k * 30, LAT0, LON0) for k in range(20)]
        out = delay.estimate_trip(self.trip, self.sched["stops"], DAY, lay + drive(8 * 3600, 6, 300, 1000, 0, obs_every=30))
        s0 = next(e for e in out if e["pos"] == 0)
        self.assertAlmostEqual(s0["delay_s"], 0, delta=30)

    def test_layover_does_not_make_fake_early_rate_and_red_segment(self):
        # 12 便すべて定刻運行（始発で 8 分待機）。定時率 100%・早発 0%・区間の遅れ増加 0 のはず。
        # 現行: 早発 16.7%、最初の区間「停留所0→停留所1」が +480 秒で「遅れが増える区間」の1位になる。
        starts = [10 * 3600 + k * 600 for k in range(12)]
        sched, _ = make_line_schedule(n_stops=6, starts=tuple(starts), run_s=300)
        recs = []
        for s0 in starts:
            obs = [(BASE + s0 - 480 + k * 60, LAT0, LON0) for k in range(8)] + drive(s0, 6, 300, 1000, 0)
            recs += [vrec(t, f"V{s0}", f"T{s0}", "20261118", lat, lon) for t, lat, lon in obs]
        rows, _ = delay.estimate_all(recs, sched)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertEqual(r["early_pct"], 0.0)
        top = next(s for s in agg["segments"] if s["band"] == "all")
        self.assertLess(top["median_added_s"], 30, f"{top['from']}→{top['to']} が {top['median_added_s']} 秒の遅れ増加と表示される")

    def test_dwell_at_timing_stop_is_not_early(self):
        # 時刻表: 各停留所で着 → 120 秒後に発（時間調整）。車両は着時刻に着き、発時刻ちょうどに発車（定刻）。
        # 現行: 「着いた時刻」を「発車時刻」と比べるため -120 秒 = 早発（定義 -60 秒より早い）に分類される。
        sched, _ = make_line_schedule(n_stops=6, starts=(8 * 3600,), run_s=300, dwell=120)
        trip = sched["trips"][f"T{8 * 3600}"]
        obs, t = [], 8 * 3600
        for i in range(6):
            x = i * 1000.0
            if i > 0:
                obs += [(BASE + t + k, LAT0, LON0 + x / M_PER_DEG_LON) for k in range(0, 121, 30)]
            if i == 5:
                break
            t_dep = t + 120
            obs += [(BASE + t_dep + k, LAT0, LON0 + (x + 1000.0 * k / 180) / M_PER_DEG_LON) for k in range(0, 180, 30)]
            t += 300
        out = delay.estimate_trip(trip, sched["stops"], DAY, obs)
        mids = [e for e in out if 0 < e["pos"] < 5]
        self.assertTrue(mids)
        for e in mids:
            self.assertGreaterEqual(e["delay_s"], aggregate.EARLY_S, f"停留所{e['pos']} が {e['delay_s']:.0f} 秒（早発）")


class TestRouteShapes(unittest.TestCase):
    """ループ線・往復線（同じ道を行き帰りする1便）。コミュニティバスに多い形。"""

    def test_loop_route_layover_slightly_off_stop(self):
        # 600m 四方のループ A→B→C→D→A。始発 A の 5m 北（D→A 側）で待機し、60 秒遅れで一周。
        # 現行: 最初の観測が最終区間 D→A に射影され、以後の位置は「戻れない」ため B・C・D が全て消える。
        # 残る推定は終点 A の -660 秒（11 分早着）だけ。
        sq = [(0, 0), (600, 0), (600, 600), (0, 600), (0, 0)]
        s = path_schedule(sq, ["A", "B", "C", "D", "A"])
        lay = [(BASE + 8 * 3600 - 300 + k * 30,) + ll(0, 5) for k in range(10)]
        out = delay.estimate_trip(s["trips"]["T1"], s["stops"], DAY, lay + drive_path(sq, 180, 8 * 3600, 60))
        got = {e["stop_id"]: e["delay_s"] for e in out if 0 < e["pos"] < 4}
        self.assertEqual(set(got), {"B", "C", "D"})
        for sid, d in got.items():
            self.assertAlmostEqual(d, 60, delta=30, msg=sid)

    def test_out_and_back_with_gps_bias(self):
        # 同じ道を往復する1便。往路と復路の停留所は道の反対側（12m 離れる）。往路の GPS が 7m 北に寄る。
        # 現行: 往路の最初の観測が復路の終点側に射影され、往路の停留所が全て消え、終点が -660 秒になる。
        oab = [(0, 0), (400, 0), (800, 0), (1200, 0), (800, 12), (400, 12), (0, 12)]
        s = path_schedule(oab, ["A", "B", "C", "D", "C2", "B2", "A2"], run=120)
        obs = drive_path(oab, 120, 8 * 3600, 60, jitter=lambda t, x, y: (x, 7.0 if t < 360 else y))
        out = delay.estimate_trip(s["trips"]["T1"], s["stops"], DAY, obs)
        self.assertGreaterEqual(len(out), 6)
        for e in out:
            self.assertAlmostEqual(e["delay_s"], 60, delta=30, msg=e["stop_id"])

    def test_out_and_back_with_random_gps_noise(self):
        # 同じ往復線で、GPS 誤差（標準偏差 5m）をランダムに付けて 50 回走らせる。
        # 一直線の路線なら同じ誤差で外れ 0 件。往復線では停留所の約 4 割が 30 秒以上外れる（現行）。
        oab = [(0, 0), (400, 0), (800, 0), (1200, 0), (800, 12), (400, 12), (0, 12)]
        s = path_schedule(oab, ["A", "B", "C", "D", "C2", "B2", "A2"], run=120)
        wrong = total = 0
        for seed in range(50):
            rnd = random.Random(seed)
            obs = drive_path(oab, 120, 8 * 3600, 60, jitter=lambda t, x, y: (x + rnd.gauss(0, 5), y + rnd.gauss(0, 5)))
            for e in delay.estimate_trip(s["trips"]["T1"], s["stops"], DAY, obs):
                total += 1
                wrong += abs(e["delay_s"] - 60) > 30
        self.assertLess(wrong / max(total, 1), 0.05, f"{wrong}/{total} 件が 30 秒以上外れた")

    def test_straight_route_with_same_noise_is_fine(self):
        # 対照: 一直線の路線なら、同じ GPS 誤差でも外れは 0 件（守れている）。
        s, _ = make_line_schedule(n_stops=7, starts=(8 * 3600,), run_s=120, spacing_m=400)
        pts = [(i * 400, 0) for i in range(7)]
        wrong = 0
        for seed in range(50):
            rnd = random.Random(seed)
            obs = drive_path(pts, 120, 8 * 3600, 60, jitter=lambda t, x, y: (x + rnd.gauss(0, 5), y + rnd.gauss(0, 5)))
            wrong += sum(abs(e["delay_s"] - 60) > 30 for e in delay.estimate_trip(s["trips"][f"T{8 * 3600}"], s["stops"], DAY, obs))
        self.assertEqual(wrong, 0)


class TestFeedQuirks(unittest.TestCase):
    """GTFS-RT の配信のくせ（実データで確認したもの・起きうるもの）。"""

    def setUp(self):
        self.sched, _ = make_line_schedule(n_stops=6, starts=(8 * 3600,), run_s=300)

    def test_multi_day_accumulation_without_start_date(self):
        # 実データ: 車両がいた 7 事業者のうち 6 事業者で VehiclePosition の start_date が空（data/raw で確認）。
        # trip_id は「平日_17時55分_系統07」のように毎平日同じ。同じ車両が同じ便を 3 日走ると、
        # 現行は (trip_id, None, 車両) で 3 日分を 1 つにまとめ、中央値に近い 1 日だけを推定する（2 日分が消える）。
        recs = []
        for d in range(3):
            for t, lat, lon in drive(8 * 3600, 6, 300, 1000, 60):
                recs.append(vrec(t + d * 86400, "V1", f"T{8 * 3600}", None, lat, lon))
        rows, _ = delay.estimate_all(recs, self.sched)
        self.assertEqual(sorted({r["date"] for r in rows}), ["2026-11-18", "2026-11-19", "2026-11-20"])

    def test_vehicle_id_missing_entity_id_changes(self):
        # vehicle.id が無く entity.id が取得ごとに変わる配信（collect.py は entity.id で代用する）。
        # 現行: 観測が 1 点ずつ別の車両とみなされ、推定 0 件。品質の判定にも出ない。
        recs = [vrec(t, f"e{k}", f"T{8 * 3600}", "20261118", lat, lon)
                for k, (t, lat, lon) in enumerate(drive(8 * 3600, 6, 300, 1000, 60))]
        rows, _ = delay.estimate_all(recs, self.sched)
        self.assertTrue(rows)

    def test_millisecond_timestamp(self):
        # vehicle.timestamp をミリ秒で出す配信。現行: 運行時間帯の外とみなされ、黙って推定 0 件。
        recs = [vrec(t, "V1", f"T{8 * 3600}", "20261118", lat, lon, ts=int(t) * 1000)
                for t, lat, lon in drive(8 * 3600, 6, 300, 1000, 60)]
        rows, _ = delay.estimate_all(recs, self.sched)
        self.assertTrue(rows)

    def test_frozen_position_with_fresh_timestamp(self):
        # 車両の通信が 6 分途切れ、配信が「最後の位置」をタイムスタンプだけ更新して出し続ける。
        # 実際は定刻。現行: 凍結中に通過した停留所 S2 が +194 秒（3 分遅れ）と推定される。
        trip = self.sched["trips"][f"T{8 * 3600}"]
        obs, frozen = [], None
        for t, lat, lon in drive(8 * 3600, 6, 300, 1000, 0, obs_every=30):
            if 420 <= t - BASE - 8 * 3600 <= 780:
                frozen = frozen or (lat, lon)
                obs.append((t,) + frozen)
            else:
                obs.append((t, lat, lon))
        out = delay.estimate_trip(trip, self.sched["stops"], DAY, obs)
        for e in out:
            self.assertAlmostEqual(e["delay_s"], 0, delta=60, msg=f"停留所{e['pos']}")

    def test_duplicate_polls_do_not_change_estimate(self):
        # 取得が二重に走った（cron の重なり）。同じ記録が 2 回あっても推定は変わらない（守れている）。
        recs = [vrec(t, "V1", f"T{8 * 3600}", "20261118", lat, lon) for t, lat, lon in drive(8 * 3600, 6, 300, 1000, 120)]
        a, _ = delay.estimate_all(recs, self.sched)
        b, _ = delay.estimate_all(recs + recs, self.sched)
        self.assertEqual([round(r["delay_s"]) for r in a], [round(r["delay_s"]) for r in b])

    def test_midnight_crossing_with_start_date(self):
        # 23:50 発・翌 0:15 着の便を start_date 付きで観測。日付をまたいでも遅れ 90 秒（守れている）。
        sched, _ = make_line_schedule(n_stops=6, starts=(23 * 3600 + 3000,), run_s=300)
        tid = f"T{23 * 3600 + 3000}"
        recs = [vrec(t, "V1", tid, "20261118", lat, lon) for t, lat, lon in drive(23 * 3600 + 3000, 6, 300, 1000, 90)]
        rows, _ = delay.estimate_all(recs, sched)
        self.assertGreaterEqual(len(rows), 5)
        self.assertTrue(all(abs(r["delay_s"] - 90) < 5 for r in rows))


# ---------------------------------------------------------------- 公開集計（build.py）
STARTS8 = [10 * 3600 + k * 600 for k in range(8)]
SRC = {"dataset": "demo_op", "name": "デモ交通", "page": "https://ckan.odpt.org/dataset/demo"}


def recs_for(starts, delay_s=0):
    out = []
    for s0 in starts:
        out += [vrec(t, f"V{s0}", f"T{s0}", "20261118", lat, lon) for t, lat, lon in drive(s0, 6, 300, 1000, delay_s)]
    return out


class TestPublicOutput(unittest.TestCase):

    def test_public_respects_sample_threshold_everywhere(self):
        # 8 便（MIN_TRIPS=10 未満）。路線の表は「サンプル不足」で数値を出さないのに、
        # 同じ公開 JSON の区間（n>=8）と停留所（n>=8、定時率・遅れ中央値つき）は数値が出る。
        # README は「停留所別の公開は事業者の了承を得たうえで」としているが、停留所の定時率が公開ファイルに入る。
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        pub, _, _ = build.build_operator(SRC, recs_for(STARTS8, 400), sched, DAY)
        r = next(x for x in pub["routes"] if x["band"] == "all")
        self.assertFalse(r["enough"])
        self.assertEqual(pub["stops"], [], "停留所別の定時率が公開 JSON に入っている")
        self.assertEqual(pub["segments"], [], "路線がサンプル不足なのに区間の数値が公開される")

    def test_segment_cut_is_per_band(self):
        # 公開する区間を「全時間帯をまとめた上位 400 件」で切ってから時間帯で絞るため、
        # 大きい事業者では遅れの小さい時間帯（例: 日中）の区間が地図から消え、地図は赤い区間ばかりになる。
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        segs = [{"route_id": "R", "name": "R", "dir": "0", "from": "a", "to": "b", "from_lat": 35, "from_lon": 139,
                 "to_lat": 35, "to_lon": 139.01, "band": "all", "n": 9, "median_added_s": 100 + i, "p90_added_s": 1,
                 "sched_run_s": 60, "added_pct_of_run": 1} for i in range(450)]
        segs += [dict(segs[0], band="day", median_added_s=5)]
        fake = {"routes": [], "segments": sorted(segs, key=lambda s: -s["median_added_s"]), "stops": [], "days": ["2026-11-18"], "params": {}}
        with mock.patch.object(aggregate, "aggregate", return_value=fake):
            pub, _, _ = build.build_operator(SRC, recs_for(STARTS8), sched, DAY)
        self.assertTrue([s for s in pub["segments"] if s["band"] == "day"], "日中の区間が公開 JSON から落ちた")

    def test_empty_day_builds_and_says_so(self):
        # 夜間で車両 0 台の記録だけ。build は落ちず、路線・区間は空（守れている）。
        recs = [{"t": int(BASE) + k * 30, "kind": "v", "ok": True, "ft": int(BASE) + k * 30, "n": 0, "v": []} for k in range(40)]
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        pub, rows, _ = build.build_operator(SRC, recs, sched, DAY)
        self.assertEqual((rows, pub["routes"], pub["segments"]), ([], [], []))
        self.assertEqual(pub["quality"]["verdict"], "判定不能")

    def test_one_corrupt_gtfs_does_not_abort_whole_build(self):
        # 静的 GTFS の 1 件が途中で切れた zip（取得の中断）。現行: BadZipFile で build 全体が止まり、
        # 他の事業者の公開集計も index.json も作られない。
        names = [s["dataset"] for s in sorted(json.loads((APP / "data" / "sources.json").read_text(encoding="utf-8")),
                                               key=lambda x: x["name"])][:2]
        sched_zip = make_line_schedule(starts=tuple(STARTS8))[1]
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            for i, ds in enumerate(names):
                (d / "raw" / ds).mkdir(parents=True)
                (d / "raw" / ds / "20261118.jsonl").write_text(
                    "\n".join(json.dumps(r) for r in recs_for(STARTS8)), encoding="utf-8")
                (d / "gtfs").mkdir(exist_ok=True)
                (d / "gtfs" / f"{ds}.zip").write_bytes(sched_zip[:200] if i == 0 else sched_zip)
            p = subprocess.run([sys.executable, "-m", "teiji.build", "--raw-dir", str(d / "raw"), "--gtfs-dir", str(d / "gtfs"),
                                "--web-data", str(d / "web"), "--detail-dir", str(d / "out")],
                               cwd=APP, capture_output=True, text=True, timeout=120)
            self.assertTrue((d / "web" / "index.json").exists(), p.stderr[-300:])
            self.assertTrue((d / "web" / f"{names[1]}.json").exists())


class TestGuidelineNotice(unittest.TestCase):

    def test_page_has_odpt_guideline_notice(self):
        # 開発者ガイドライン 3.1 の 3 点（センター提供・正確性を保証しない・開発者の問い合わせ先）。
        # 現行アプリ（../app）は表示しているが、本アプリは「保証しない」と「問い合わせ先」が無い。
        text = "".join((APP / "web" / f).read_text(encoding="utf-8") for f in ("index.html", "app.js", "lib.js"))
        self.assertTrue("保証" in text, "「正確性を保証しない」旨の表示が無い")
        self.assertTrue("問い合わせ" in text, "開発者の問い合わせ先が無い")


if __name__ == "__main__":
    unittest.main()
