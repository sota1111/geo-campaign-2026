"""取得済みデータから、画面用の公開集計（web/data/）と事業者向け詳細 CSV（out/operator-detail/）を作る。

    python3 -m teiji.build [--raw-dir data/raw] [--gtfs-dir data/gtfs] [--web-data web/data] [--detail-dir out/operator-detail]

公開と詳細の分け方:
  web/data/   公開用集計。路線×時間帯、区間、停留所の集計だけ。サンプル不足の行は数値を出さない。
              事業者を横並びにして順位を付ける項目・画面は作らない（事業者は名称順に並べるだけ）。
  out/        事業者向け詳細。便ごとの推定（trips.csv）、停留所×路線×時間帯など。公開ホスティングに置かない。
"""
import argparse
import csv
import datetime as dt
import json
import time
from pathlib import Path

from . import aggregate, delay, quality
from .gtfs import load_schedule

ROOT = Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
CREDIT = "公共交通オープンデータセンター（{name}）、CC BY 4.0。位置と時刻表からの遅れの推定・集計は本アプリによる加工"


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def hhmm(epoch):
    return dt.datetime.fromtimestamp(epoch, JST).strftime("%Y-%m-%d %H:%M:%S")


def build_operator(src, recs, schedule, today):
    q = quality.measure_dataset(recs, schedule, today)
    obs_days = sorted({dt.datetime.fromtimestamp(r["t"], JST).strftime("%Y-%m-%d") for r in recs if r.get("ok")})
    rows, est_stats = ([], {"trips_observed": 0, "trips_matched": 0, "trips_estimated": 0})
    agg = {"routes": [], "segments": [], "stops": [], "days": [], "params": {}}
    if schedule:
        rows, est_stats = delay.estimate_all(recs, schedule)
        if rows:
            agg = aggregate.aggregate(rows, schedule)
    last_t = max((r["t"] for r in recs), default=None)
    first_t = min((r["t"] for r in recs), default=None)
    pub = {
        "id": src["dataset"], "name": src["name"], "license": "CC BY 4.0", "credit": CREDIT.format(name=src["name"]), "page": src["page"],
        "period": {"first": hhmm(first_t) if first_t else None, "last": hhmm(last_t) if last_t else None,
                   "observed_days": obs_days, "estimated_days": agg["days"], "polls": q["polls_ok"]},
        "quality": {k: q.get(k) for k in ("vehicles_median", "vehicles_max", "vehicles_median_daytime", "position_interval_s",
                                         "trip_match_active_pct", "trip_match_pct", "daytime_polls", "verdict", "verdict_reason")},
        "estimate": {**est_stats, "stop_estimates": len(rows)},
        "routes": [_pub_route(r) for r in agg["routes"]],
        "segments": [_pub_seg(s) for s in agg["segments"][:400]],
        "stops": agg["stops"], "params": agg["params"],
    }
    return pub, rows, agg


def _pub_route(r):
    keep = ("route_id", "name", "band", "n_trips", "enough", "bunch_enough")
    out = {k: r[k] for k in keep}
    if r["enough"]:
        for k in ("n_obs", "ontime_pct", "late_pct", "early_pct", "median_delay_s", "p90_delay_s"):
            out[k] = r[k]
    if r["bunch_enough"]:
        out.update({"bunch_pairs": r["bunch_pairs"], "bunch_pct": r["bunch_pct"], "gap_pct": r["gap_pct"]})
    return out


def _pub_seg(s):
    return {k: s[k] for k in ("route_id", "name", "dir", "from", "to", "from_lat", "from_lon", "to_lat", "to_lon", "band",
                              "n", "median_added_s", "p90_added_s", "sched_run_s", "added_pct_of_run")}


def write_detail(dirpath, pub, rows, agg, schedule):
    write_csv(dirpath / "routes.csv",
              ["route_id", "路線名", "時間帯", "便数", "観測数", "定時率%", "遅れ(5分超)%", "早発%", "遅れ中央値(秒)", "遅れ90%点(秒)", "団子運転の組数", "団子運転%", "間延び%", "サンプル十分"],
              [[r["route_id"], r["name"], aggregate.BAND_LABEL[r["band"]], r["n_trips"], r["n_obs"], r.get("ontime_pct"), r.get("late_pct"),
                r.get("early_pct"), r.get("median_delay_s"), r.get("p90_delay_s"), r["bunch_pairs"], r["bunch_pct"], r["gap_pct"],
                "はい" if r["enough"] else "いいえ"] for r in agg["routes"]])
    write_csv(dirpath / "segments.csv",
              ["route_id", "路線名", "方向", "区間の始点", "区間の終点", "時間帯", "観測数", "区間で増えた遅れの中央値(秒)", "同90%点(秒)", "時刻表の所要(秒)", "所要に対する増加%"],
              [[s["route_id"], s["name"], s["dir"], s["from"], s["to"], aggregate.BAND_LABEL[s["band"]], s["n"], s["median_added_s"],
                s["p90_added_s"], s["sched_run_s"], s["added_pct_of_run"]] for s in agg["segments"]])
    write_csv(dirpath / "stops.csv", ["stop_id", "停留所", "緯度", "経度", "観測数", "定時率%", "遅れ(5分超)%", "遅れ中央値(秒)"],
              [[s["stop_id"], s["name"], s["lat"], s["lon"], s["n_obs"], s["ontime_pct"], s["late_pct"], s["median_delay_s"]] for s in agg["stops"]])
    names = {k: v[2] for k, v in schedule["stops"].items()}
    write_csv(dirpath / "trips.csv", ["運行日", "trip_id", "route_id", "車両ID", "stop_sequence", "停留所", "時刻表", "推定通過", "遅れ(秒)"],
              [[r["date"], r["trip_id"], r["route_id"], r["vehicle"], r["seq_no"], names.get(r["stop_id"], r["stop_id"]),
                hhmm(r["sched"]), hhmm(r["actual"]), round(r["delay_s"])] for r in rows])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=str(ROOT / "data" / "raw"))
    ap.add_argument("--gtfs-dir", default=str(ROOT / "data" / "gtfs"))
    ap.add_argument("--web-data", default=str(ROOT / "web" / "data"))
    ap.add_argument("--detail-dir", default=str(ROOT / "out" / "operator-detail"))
    a = ap.parse_args()
    src = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))
    web = Path(a.web_data)
    web.mkdir(parents=True, exist_ok=True)
    index = []
    for s in sorted(src, key=lambda x: x["name"]):
        recs = quality.read_records(a.raw_dir, s["dataset"])
        if not recs:
            continue
        last = max(r["t"] for r in recs)
        today = dt.datetime.fromtimestamp(last, JST).date()
        gz = Path(a.gtfs_dir) / f"{s['dataset']}.zip"
        schedule = load_schedule(str(gz), today) if gz.exists() else None
        pub, rows, agg = build_operator(s, recs, schedule, today)
        (web / f"{s['dataset']}.json").write_text(json.dumps(pub, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if schedule and rows:
            write_detail(Path(a.detail_dir) / s["dataset"], pub, rows, agg, schedule)
        index.append({"id": s["dataset"], "name": s["name"], "verdict": pub["quality"]["verdict"], "stop_estimates": len(rows),
                      "last": pub["period"]["last"], "first": pub["period"]["first"], "observed_days": pub["period"]["observed_days"]})
        print(f"{s['name']}: 推定 {len(rows)} 件 ({pub['quality']['verdict']})")
    meta = {"generated": hhmm(time.time()), "operators": index,
            "note": "事業者は名称順に並べているだけで、順位や優劣ではありません。"}
    (web / "index.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
