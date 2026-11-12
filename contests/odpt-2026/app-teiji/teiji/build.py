"""取得済みデータから、画面用の公開集計（web/data/）と事業者向け詳細 CSV（out/operator-detail/）を作る。

    python3 -m teiji.build [--raw-dir data/raw] [--gtfs-dir data/gtfs] [--web-data web/data] [--detail-dir out/operator-detail]

公開と詳細の分け方:
  web/data/   公開用集計。路線×時間帯の集計と、サンプルが足りた路線×時間帯の区間（地図用）。停留所別は入れない。
              サンプル不足の行は数値を出さない。品質の判定（通過・不通過）と理由も入れない（件数の要約だけ）。
              事業者を横並びにして順位を付ける項目・画面は作らない（事業者は名称順に並べるだけ）。
  out/        事業者向け詳細。便ごとの推定（trips.csv）、停留所別（stops.csv）、全区間、品質の判定（quality.json）。
              公開ホスティングに置かない。
処理は運行日ごとのストリーミング（記録は 1 行ずつ読み、推定の行は日ごとに trips.csv へ追記して捨てる）。
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

from . import aggregate, delay, quality
from .gtfs import load_schedule

ROOT = Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
CREDIT = "公共交通オープンデータセンター（{name}）、CC BY 4.0。位置と時刻表からの遅れの推定・集計は本アプリによる加工"
PUBLISH_SEGMENTS = True      # False にすると公開 JSON に区間を一切入れない（路線×時間帯の集計だけになる）
MAX_SEG_PER_BAND = 400       # 公開する区間の数（時間帯ごと。超えたら遅れの大きい側と小さい側を半分ずつ残す）


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def hhmm(epoch):
    return dt.datetime.fromtimestamp(epoch, JST).strftime("%Y-%m-%d %H:%M:%S")


class TripsCsv:
    """便ごとの推定（事業者向け trips.csv）を、運行日ごとに追記して書く。全部をメモリに持たない。"""
    HEADER = ["運行日", "trip_id", "route_id", "車両ID", "stop_sequence", "停留所", "時刻表", "推定通過", "遅れ(秒)", "到着の推定", "到着の遅れ(秒)"]

    def __init__(self, path, stop_names):
        self.path, self.names, self.n = Path(path), stop_names, 0
        self.f = self.w = None

    def add(self, rows):
        if not rows:
            return
        if self.f is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.f = self.path.open("w", encoding="utf-8-sig", newline="")
            self.w = csv.writer(self.f)
            self.w.writerow(self.HEADER)
        for r in rows:
            self.w.writerow([r["date"], r["trip_id"], r["route_id"], r["vehicle"], r["seq_no"], self.names.get(r["stop_id"], r["stop_id"]),
                             hhmm(r["sched"]), hhmm(r["actual"]), round(r["delay_s"]),
                             hhmm(r["arr_actual"]) if r.get("arr_actual") else "",
                             round(r["arr_delay_s"]) if r.get("arr_delay_s") is not None else ""])
            self.n += 1

    def close(self):
        if self.f:
            self.f.close()


def public_segments(agg):
    """公開する区間。サンプル不足の路線×時間帯の区間は出さない。時間帯ごとに MAX_SEG_PER_BAND 件まで。"""
    if not PUBLISH_SEGMENTS:
        return []
    enough = {(r["route_id"], r["band"]): r["enough"] for r in agg["routes"]}
    by_band = {}
    for sg in agg["segments"]:                       # 遅れの大きい順
        if enough.get((sg["route_id"], sg["band"]), True):
            by_band.setdefault(sg["band"], []).append(sg)
    out = []
    for band, lst in by_band.items():
        if len(lst) > MAX_SEG_PER_BAND:
            h = MAX_SEG_PER_BAND // 2
            lst = lst[:h] + lst[-h:]
        out += [_pub_seg(x) for x in lst]
    return out


def build_operator(src, recs, schedule, today, sink=None):
    """recs は何度でも読み直せる記録の列（リスト、または quality.RecordStream）。運行日ごとに推定して積み上げる。
    sink（.add(rows) を持つもの）を渡すと、推定の行はそこへ日ごとに流し、戻り値の rows は空リストになる（メモリを抑える）。
    戻り値 (公開用の辞書, 推定の行, 集計)。集計 agg には事業者向けの品質の詳細 agg["quality_detail"] と行数 agg["n_rows"] が入る。"""
    q = quality.measure_dataset(recs, schedule, today)
    rows, n_rows = [], 0
    est_stats = {"trips_observed": 0, "trips_matched": 0, "trips_estimated": 0}
    agg = {"routes": [], "segments": [], "stops": [], "days": [], "params": {}}
    if schedule:
        acc = aggregate.Accumulator(schedule)
        for _, rs, st in delay.estimate_days(recs, schedule):
            for k in est_stats:
                est_stats[k] += st[k]
            n_rows += len(rs)
            acc.add_day(rs)
            if sink is not None:
                sink.add(rs)
            else:
                rows += rs
        if n_rows:
            agg = aggregate.aggregate(acc, schedule)
    agg["quality_detail"] = q
    agg["n_rows"] = n_rows
    last_t, first_t = q.get("last_t"), q.get("first_t")
    pub = {
        "id": src["dataset"], "name": src["name"], "license": "CC BY 4.0", "credit": CREDIT.format(name=src["name"]), "page": src["page"],
        "period": {"first": hhmm(first_t) if first_t else None, "last": hhmm(last_t) if last_t else None,
                   "observed_days": q["observed_days"], "estimated_days": agg["days"], "polls": q["polls_ok"]},
        # 公開するのは件数の要約だけ。品質の判定（通過・不通過）と理由は事業者向け（out/）にだけ置く
        "quality": {**{k: q.get(k) for k in ("vehicles_median", "vehicles_max")},
                    # 「通過・不通過」は公開しない。日中の取得が足りず測れないときの「判定不能」「データなし」だけは評価ではないので残す
                    **({"verdict": q["verdict"]} if q["verdict"] in ("判定不能", "データなし") else {})},
        "estimate": {**est_stats, "stop_estimates": n_rows},
        "routes": [_pub_route(r) for r in agg["routes"]],
        "segments": public_segments(agg),
        "stops": [],        # 停留所別の集計は公開しない（事業者向けの stops.csv にだけ入れる）。キーは互換のため残す
        "params": agg["params"],
    }
    return pub, rows, agg


def status_of(pub):
    """公開用の状態。順位や格付けではなく、集計を出せるかどうかだけ。"""
    return "集計あり" if any(r["enough"] for r in pub["routes"]) else "蓄積中"


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


def write_detail_tables(dirpath, agg, schedule):
    """事業者向けの集計 CSV（out/ にだけ置く。公開しない）。"""
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


def write_quality(dirpath, agg):
    """品質の判定（通過・不通過）と理由を含む詳細。事業者向け（out/）だけ。"""
    dirpath.mkdir(parents=True, exist_ok=True)
    (dirpath / "quality.json").write_text(json.dumps(agg["quality_detail"], ensure_ascii=False, indent=1), encoding="utf-8")


def write_detail(dirpath, pub, rows, agg, schedule):
    write_detail_tables(dirpath, agg, schedule)
    write_quality(dirpath, agg)
    t = TripsCsv(dirpath / "trips.csv", {k: v[2] for k, v in schedule["stops"].items()})
    t.add(rows)
    t.close()


def write_json_atomic(path, text):
    """一時ファイルに書いてから置き換える（途中で止まっても、半端なファイルを残さない）。"""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


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
    index, errors = [], []
    for s in sorted(src, key=lambda x: x["name"]):
        last = quality.last_record_time(a.raw_dir, s["dataset"])
        if last is None:
            continue
        today = dt.datetime.fromtimestamp(last, JST).date()
        gz = Path(a.gtfs_dir) / f"{s['dataset']}.zip"
        schedule = None
        if gz.exists():
            try:
                schedule = load_schedule(str(gz), today)
            except Exception as e:      # 途中で切れた zip など。この事業者の推定だけ諦め、ほかは続ける
                errors.append(f"{s['name']}: 静的GTFSを読めません（{type(e).__name__}）")
                print(errors[-1], file=sys.stderr)
        detail = Path(a.detail_dir) / s["dataset"]
        sink = TripsCsv(detail / "trips.csv", {k: v[2] for k, v in schedule["stops"].items()}) if schedule else None
        try:
            pub, rows, agg = build_operator(s, quality.RecordStream(a.raw_dir, s["dataset"]), schedule, today, sink=sink)
        finally:
            if sink:
                sink.close()
        write_json_atomic(web / f"{s['dataset']}.json", json.dumps(pub, ensure_ascii=False, separators=(",", ":")))
        write_quality(detail, agg)
        if schedule and agg["n_rows"]:
            write_detail_tables(detail, agg, schedule)
        index.append({"id": s["dataset"], "name": s["name"], "status": status_of(pub), "stop_estimates": agg["n_rows"],
                      "last": pub["period"]["last"], "first": pub["period"]["first"], "observed_days": pub["period"]["observed_days"]})
        print(f"{s['name']}: 推定 {agg['n_rows']} 件（{status_of(pub)}）")
    meta = {"generated": hhmm(time.time()), "operators": index,
            "note": "事業者は名称順に並べているだけで、順位や優劣ではありません。"}
    write_json_atomic(web / "index.json", json.dumps(meta, ensure_ascii=False, indent=1))
    if errors:
        print("読めなかった静的GTFS: " + "；".join(errors), file=sys.stderr)


if __name__ == "__main__":
    main()
