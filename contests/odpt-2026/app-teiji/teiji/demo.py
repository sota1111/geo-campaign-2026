"""画面確認用の合成データ（実データではない）を作る。web/data-demo/ に出力し、画面は ?data=data-demo で開く。

    python3 -m teiji.demo [--out web/data-demo]

実在しない架空の事業者「合成デモ交通」を、架空の停留所・時刻表・遅れで作る。
遅れの型は、朝の特定区間で遅れが増える・夕方に団子運転が起きる、を意図的に入れてある（画面と集計の確認用）。
index.json に "synthetic": true を付け、画面に「合成データ」と常に表示する。
"""
import argparse
import datetime as dt
import io
import json
import math
import random
import zipfile
from pathlib import Path

from . import build
from .gtfs import load_schedule

ROOT = Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
DAYS = [dt.date(2026, 11, 16), dt.date(2026, 11, 17), dt.date(2026, 11, 18)]  # 月・火・水
LAT0, LON0 = 35.680, 139.760


def hms(s):
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def make_gtfs(routes):
    stops, trips, stop_times = {}, [], []
    for ri, rt in enumerate(routes):
        for k, (lat, lon) in enumerate(rt["pts"]):
            stops[f"R{ri}S{k}"] = (lat, lon, f"{rt['name']}停留所{k + 1}")
        for start in rt["starts"]:
            tid = f"R{ri}T{start}"
            trips.append((f"R{ri}", tid))
            for k in range(len(rt["pts"])):
                t = start + k * rt["run"]
                stop_times.append((tid, hms(t), hms(t), f"R{ri}S{k}", k + 1))

    def csv(rows):
        return "\n".join(",".join(str(c) for c in r) for r in rows) + "\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("stops.txt", csv([["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [[k, v[2], v[0], v[1]] for k, v in stops.items()]))
        z.writestr("routes.txt", csv([["route_id", "route_short_name", "route_long_name"]] + [[f"R{i}", r["name"], r["name"]] for i, r in enumerate(routes)]))
        z.writestr("trips.txt", csv([["route_id", "service_id", "trip_id", "direction_id"]] + [[r, "WD", t, 0] for r, t in trips]))
        z.writestr("stop_times.txt", csv([["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]] + [list(x) for x in stop_times]))
        z.writestr("calendar.txt", csv([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
                                         ["WD", 1, 1, 1, 1, 1, 0, 0, "20260101", "20271231"]]))
    return buf.getvalue()


def make_routes():
    routes = []
    for i, (name, ang) in enumerate([("デモ1系統", 0.0), ("デモ2系統", 1.2), ("デモ3系統", 2.4)]):
        pts = []
        for k in range(9):
            d = 0.0085 * k
            pts.append((LAT0 + 0.002 * i + d * math.sin(ang + 0.3), LON0 + 0.003 * i + d * math.cos(ang + 0.3)))
        starts = [6 * 3600 + 600 * j for j in range(75)]  # 6:00〜18:30、10分おき
        routes.append({"name": name, "pts": pts, "starts": starts, "run": 240})
    return routes


def delay_profile(ri, k, start, rng):
    """停留所 k（0 始まり）での遅れ（秒）。"""
    h = start / 3600
    d = rng.gauss(20, 25)
    if ri == 0 and 7 <= h < 9:           # 朝のピークに 3→4 番目、5→6 番目の区間で遅れが増える
        d += 100 * max(0, k - 2) + 60 * max(0, k - 5)
    if ri == 1 and 16 <= h < 19:         # 夕方は全体に遅れる
        d += 45 * k
    if ri == 2:
        d += 5 * k
    return d


def make_records(routes, seed=1):
    rng = random.Random(seed)
    recs = []
    for day in DAYS:
        base = dt.datetime(day.year, day.month, day.day, tzinfo=JST).timestamp()
        for ri, rt in enumerate(routes):
            prev_first = None
            for start in rt["starts"]:
                times = [start + k * rt["run"] + delay_profile(ri, k, start, rng) for k in range(len(rt["pts"]))]
                if ri == 1 and 16 <= start / 3600 < 19 and (start // 600) % 3 == 1 and prev_first is not None:
                    # 夕方、3便に1便は直前の便に追いつく（団子運転）
                    times = [prev_first[k] + 70 + rng.gauss(0, 10) for k in range(len(rt["pts"]))]
                prev_first = times
                t = times[0]
                while t <= times[-1]:
                    k = max(i for i in range(len(times)) if times[i] <= t) if t < times[-1] else len(times) - 2
                    f = (t - times[k]) / (times[k + 1] - times[k])
                    lat = rt["pts"][k][0] + f * (rt["pts"][k + 1][0] - rt["pts"][k][0])
                    lon = rt["pts"][k][1] + f * (rt["pts"][k + 1][1] - rt["pts"][k][1])
                    ts = int(base + t)
                    recs.append({"t": ts + 3, "kind": "v", "ok": True, "ft": ts, "bytes": 1, "n": 1,
                                 "v": [[f"BUS{ri}{start}", f"R{ri}T{start}", f"R{ri}", day.strftime("%Y%m%d"), round(lat, 6), round(lon, 6), ts, None, None]]})
                    t += 50
    return recs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "web" / "data-demo"))
    a = ap.parse_args()
    routes = make_routes()
    z = make_gtfs(routes)
    sched = load_schedule(z, DAYS[-1])
    recs = make_records(routes)
    src = {"dataset": "synthetic_demo", "name": "合成デモ交通（実在しない・合成データ）", "page": "https://ckan.odpt.org/"}
    pub, rows, agg = build.build_operator(src, recs, sched, DAYS[-1])
    pub["quality"]["verdict"], pub["quality"]["verdict_reason"] = "合成データ", "実データの品質判定ではありません"
    pub["license"] = "合成データ（実データではない）"
    pub["credit"] = "合成データ。実在の事業者・路線・遅れではありません（画面確認用）"
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "synthetic_demo.json").write_text(json.dumps(pub, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "index.json").write_text(json.dumps({"synthetic": True, "generated": "合成", "note": "合成データです。実在の事業者・路線・遅れではありません。",
                                                 "operators": [{"id": "synthetic_demo", "name": src["name"], "verdict": "合成", "stop_estimates": len(rows),
                                                                "first": pub["period"]["first"], "last": pub["period"]["last"],
                                                                "observed_days": pub["period"]["observed_days"]}]}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"合成デモ: 推定 {len(rows)} 件 -> {out}")


if __name__ == "__main__":
    main()
