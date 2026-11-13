"""停留所ごとの遅れの推定値（delay.estimate_all の行）から、路線×時間帯の定時率・区間の遅れ・団子運転を集計する。

定義（初期値。すべて引数で変えられる。根拠のある基準値ではなく、見せ方の仮定）:
  定時  : 遅れが -60秒 以上 +300秒 以下
  遅れ  : +300秒 を超える（5分超）
  早発  : -60秒 より早い
  団子運転: 時刻表で隣り合う同じ路線・方向の2便が同じ停留所を通った間隔が、時刻表の間隔の 25% 未満
            （時刻表の間隔が 1分以上 20分以下の停留所だけ対象。本数が少ない路線は団子運転が起きにくいため）
  間延び: 実際の間隔が時刻表の間隔の 2 倍を超える（同じ対象）
  時間帯: 朝=6〜9時（9時未満）、日中=9〜16時、夕=16〜19時、夜=19時〜翌6時。時刻表の通過時刻の時で分ける。
  サンプル不足: 便数 10 未満または観測 50 未満（団子運転は組 20 未満）は、数値を出さず「サンプル不足」とする。
"""
import datetime as dt
import statistics
from array import array
from collections import defaultdict

from .delay import JST
from .gtfs import services_on

EARLY_S, LATE_S = -60, 300
BUNCH_RATIO, GAP_RATIO = 0.25, 2.0
HEADWAY_MIN_S, HEADWAY_MAX_S = 60, 1200
MIN_TRIPS, MIN_OBS, MIN_PAIRS, MIN_SEG = 10, 50, 20, 8
BANDS = ["all", "morning", "day", "evening", "night"]
BAND_LABEL = {"all": "全時間帯", "morning": "朝（6〜9時）", "day": "日中（9〜16時）", "evening": "夕（16〜19時）", "night": "夜（19〜6時）"}


def band_of(epoch):
    h = dt.datetime.fromtimestamp(epoch, JST).hour
    if 6 <= h < 9:
        return "morning"
    if 9 <= h < 16:
        return "day"
    if 16 <= h < 19:
        return "evening"
    return "night"


def pctile(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def delay_stats(delays):
    n = len(delays)
    if not n:
        return {"n_obs": 0}
    return {
        "n_obs": n,
        "ontime_pct": round(100.0 * sum(1 for d in delays if EARLY_S <= d <= LATE_S) / n, 1),
        "late_pct": round(100.0 * sum(1 for d in delays if d > LATE_S) / n, 1),
        "early_pct": round(100.0 * sum(1 for d in delays if d < EARLY_S) / n, 1),
        "median_delay_s": round(statistics.median(delays)),
        "p90_delay_s": round(pctile(delays, 0.9)),
    }


def bunching_pairs(rows, schedule):
    """[(route_id, band, 'bunch'|'gap'|'ok')]。時刻表で隣り合う2便の両方に推定がある停留所だけ数える。"""
    by_day = defaultdict(list)
    for r in rows:
        by_day[r["date"]].append(r)
    out = []
    for dstr, rs in by_day.items():
        day = dt.date.fromisoformat(dstr)
        est = {}
        for r in sorted(rs, key=lambda r: r["pos"]):
            est.setdefault((r["trip_id"], r["stop_id"]), r["actual"])
        routes = {r["route_id"] for r in rs}
        svc = services_on(schedule, day)
        idx = defaultdict(list)
        for t in schedule["trips"].values():
            if t["route_id"] not in routes or t["service_id"] not in svc:
                continue
            seen = set()
            for no, sid, arr, dep in t["seq"]:
                if sid in seen or dep is None:
                    continue
                seen.add(sid)
                idx[(t["route_id"], t["dir"], sid)].append((dep, t["trip_id"]))
        base = dt.datetime(day.year, day.month, day.day, tzinfo=JST).timestamp()
        for (route, d, sid), lst in idx.items():
            lst.sort()
            for (s0, t0), (s1, t1) in zip(lst, lst[1:]):
                hs = s1 - s0
                if not HEADWAY_MIN_S <= hs <= HEADWAY_MAX_S:
                    continue
                a, b = est.get((t0, sid)), est.get((t1, sid))
                if a is None or b is None:
                    continue
                ha = b - a
                kind = "bunch" if ha < BUNCH_RATIO * hs else ("gap" if ha > GAP_RATIO * hs else "ok")
                out.append((route, band_of(base + s0), kind))
    return out


class Accumulator:
    """日ごとに add_day を呼んで集計を積み上げ、最後に result() で全日程の集計を返す。
    保持するのは遅れの数値の列（array）と件数だけで、推定の行そのものは持たない（メモリを抑える）。"""

    def __init__(self, schedule):
        self.schedule = schedule
        self.by = defaultdict(lambda: array("d"))          # (route, band) -> 遅れ（秒）
        self.trips = defaultdict(int)                       # (route, band) -> 便×運行日の数
        self.pairs = defaultdict(lambda: [0, 0, 0])
        self.seg = defaultdict(lambda: {"inc": array("d"), "run": array("d")})
        self.sd = defaultdict(lambda: array("d"))
        self.days = set()

    def add_day(self, rows):
        """1 運行日以上の推定の行（delay.estimate_day の行）を足す。同じ運行日を 2 回に分けて渡してはいけない。"""
        trips = defaultdict(set)
        for r in rows:
            self.days.add(r["date"])
            self.sd[r["stop_id"]].append(r["delay_s"])
            for b in ("all", band_of(r["sched"])):
                self.by[(r["route_id"], b)].append(r["delay_s"])
                trips[(r["route_id"], b)].add((r["trip_id"], r["date"]))
        for k, v in trips.items():
            self.trips[k] += len(v)
        for route, band, kind in bunching_pairs(rows, self.schedule):
            for b in ("all", band):
                c = self.pairs[(route, b)]
                c[0] += 1
                c[1] += kind == "bunch"
                c[2] += kind == "gap"
        by_trip = defaultdict(list)
        for r in rows:
            by_trip[(r["trip_id"], r["date"])].append(r)
        for rs in by_trip.values():
            rs.sort(key=lambda r: r["pos"])
            for a, b in zip(rs, rs[1:]):
                if b["pos"] - a["pos"] != 1:
                    continue
                for band in ("all", band_of(a["sched"])):
                    k = (a["route_id"], a["dir"], a["stop_id"], b["stop_id"], band)
                    self.seg[k]["inc"].append(b["delay_s"] - a["delay_s"])
                    self.seg[k]["run"].append(b["sched"] - a["sched"])

    def result(self):
        schedule = self.schedule
        route_name = schedule["routes"]
        routes = []
        for (route, band), ds in sorted(self.by.items()):
            st = delay_stats(ds)
            short, long_ = route_name.get(route, ("", ""))
            row = {"route_id": route, "name": short or long_ or route, "long_name": long_, "band": band, "n_trips": self.trips[(route, band)], **st}
            row["enough"] = row["n_trips"] >= MIN_TRIPS and row["n_obs"] >= MIN_OBS
            n_p, n_b, n_g = self.pairs.get((route, band), [0, 0, 0])
            row["bunch_pairs"] = n_p
            row["bunch_enough"] = n_p >= MIN_PAIRS
            row["bunch_pct"] = round(100.0 * n_b / n_p, 1) if n_p else None
            row["gap_pct"] = round(100.0 * n_g / n_p, 1) if n_p else None
            routes.append(row)
        stops = schedule["stops"]
        segments = []
        for (route, d, s0, s1, band), v in self.seg.items():
            n = len(v["inc"])
            if n < MIN_SEG:
                continue
            a, b = stops.get(s0), stops.get(s1)
            if not a or not b:
                continue
            run = statistics.median(v["run"])
            inc = statistics.median(v["inc"])
            segments.append({"route_id": route, "name": (route_name.get(route, ("", ""))[0] or route), "dir": d, "from_id": s0, "to_id": s1,
                             "from": a[2], "to": b[2], "from_lat": a[0], "from_lon": a[1], "to_lat": b[0], "to_lon": b[1],
                             "band": band, "n": n, "median_added_s": round(inc), "p90_added_s": round(pctile(v["inc"], 0.9)),
                             "sched_run_s": round(run), "added_pct_of_run": round(100.0 * inc / run, 1) if run > 0 else None})
        segments.sort(key=lambda s: -s["median_added_s"])
        stop_rows = []
        for sid, ds in self.sd.items():
            if len(ds) < MIN_SEG or sid not in stops:
                continue
            st = delay_stats(ds)
            stop_rows.append({"stop_id": sid, "name": stops[sid][2], "lat": stops[sid][0], "lon": stops[sid][1], **st})
        return {"routes": routes, "segments": segments, "stops": stop_rows, "days": sorted(self.days),
                "params": {"early_s": EARLY_S, "late_s": LATE_S, "bunch_ratio": BUNCH_RATIO, "gap_ratio": GAP_RATIO,
                           "headway_range_s": [HEADWAY_MIN_S, HEADWAY_MAX_S], "min_trips": MIN_TRIPS, "min_obs": MIN_OBS,
                           "min_pairs": MIN_PAIRS, "min_segment_obs": MIN_SEG}}


def aggregate(rows, schedule):
    """rows: delay.estimate_all の行（複数の運行日を含んでよい）。または、日ごとに積み上げた Accumulator。
    戻り値は web/CSV 用の辞書。"""
    if isinstance(rows, Accumulator):
        return rows.result()
    acc = Accumulator(schedule)
    acc.add_day(rows)
    return acc.result()
