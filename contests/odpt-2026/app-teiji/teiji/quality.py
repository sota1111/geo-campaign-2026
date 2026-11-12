"""データ品質の測定。取得済みの data/raw/ と data/gtfs/ から、事業者ごとに次を測る。

  取得成功率 / 車両数（1回の取得あたり）/ フィード更新間隔 / 車両ごとの位置更新間隔 / 位置の古さ
  / trip_id の GTFS 一致率（全 trip・運行日の trip）/ stop_id の一致率 / TripUpdate の遅れ値の有無

    python3 -m teiji.quality [--day 20261113] [--out data/quality.json]

判定（ゲート。閾値は工兵が設定。根拠は README）:
  日中サンプル（7〜19時の取得）が 10 回未満なら「判定不能（夜間・短時間）」。
  それ以外は 取得成功率>=95% かつ 日中の車両数の中央値>=5 かつ 位置更新間隔の中央値<=90秒
  かつ 運行日の trip_id 一致率>=90% で「通過」、満たさなければ「不通過」（どの条件かを併記）。
"""
import argparse
import datetime as dt
import json
import statistics
from pathlib import Path

from .gtfs import load_schedule

ROOT = Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
DAY_HOURS = range(7, 19)
GATE = {"success": 0.95, "vehicles_median": 5, "pos_interval_s": 90, "trip_match": 0.90, "min_daytime_polls": 10}


def read_records(raw_dir, dataset, day=None):
    out = []
    d = Path(raw_dir) / dataset
    if not d.exists():
        return out
    for f in sorted(d.glob("*.jsonl")):
        if day and f.stem != day:
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def med(xs):
    return statistics.median(xs) if xs else None


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def measure_dataset(recs, schedule=None, today=None):
    """recs: read_records の結果。schedule: load_schedule の結果（なければ一致率は None）。"""
    v = [r for r in recs if r["kind"] == "v"]
    u = [r for r in recs if r["kind"] == "u"]
    vok = [r for r in v if r.get("ok")]
    res = {"polls": len(v), "polls_ok": len(vok), "success_rate": pct(len(vok), len(v))}
    hours = [dt.datetime.fromtimestamp(r["t"], JST).hour for r in vok]
    day_idx = [i for i, h in enumerate(hours) if h in DAY_HOURS]
    res["daytime_polls"] = len(day_idx)
    if v:
        res["first"] = dt.datetime.fromtimestamp(min(r["t"] for r in v), JST).strftime("%Y-%m-%d %H:%M")
        res["last"] = dt.datetime.fromtimestamp(max(r["t"] for r in v), JST).strftime("%Y-%m-%d %H:%M")
    counts = [r["n"] for r in vok]
    res["vehicles_median"] = med(counts)
    res["vehicles_max"] = max(counts) if counts else None
    day_counts = [vok[i]["n"] for i in day_idx]
    res["vehicles_median_daytime"] = med(day_counts)
    # フィード時刻の更新間隔
    fts = sorted({r["ft"] for r in vok if r.get("ft")})
    res["feed_interval_s"] = med([b - a for a, b in zip(fts, fts[1:])])
    res["same_ft_share"] = pct(sum(1 for r in vok if r.get("same")), len(vok))
    # 車両ごとの位置更新間隔、位置の古さ
    seen, ages, diffs = {}, [], []
    trips_seen, with_trip, rows_n = set(), 0, 0
    stop_hit = stop_rows = 0
    for r in vok:
        for row in r.get("v") or []:
            vid, trip, route, sdate, lat, lon, ts, seq, sid = row
            rows_n += 1
            if trip:
                with_trip += 1
                trips_seen.add(trip)
            if ts:
                ages.append(r["t"] - ts)
                if vid in seen and ts != seen[vid]:
                    diffs.append(ts - seen[vid])
                seen[vid] = ts
            if sid and schedule:
                stop_rows += 1
                stop_hit += sid in schedule["stops"]
    res["position_interval_s"] = med([d for d in diffs if d > 0])
    res["position_age_s"] = med(ages)
    res["vehicle_rows"] = rows_n
    res["trip_id_present_pct"] = pct(with_trip, rows_n)
    res["distinct_trips"] = len(trips_seen)
    res["distinct_vehicles"] = len({row[0] for r in vok for row in (r.get("v") or [])})
    if schedule:
        hit_all = sum(1 for t in trips_seen if t in schedule["trip_ids"])
        hit_act = sum(1 for t in trips_seen if t in schedule["trip_ids"] and schedule["trips"][t]["active"])
        res["trip_match_pct"] = pct(hit_all, len(trips_seen))
        res["trip_match_active_pct"] = pct(hit_act, len(trips_seen))
        res["stop_id_match_pct"] = pct(stop_hit, stop_rows)
        res["gtfs_trips"] = len(schedule["trip_ids"])
        res["gtfs_period"] = f"{schedule['start']}〜{schedule['end']}" if schedule["start"] else ""
        res["gtfs_covers_day"] = bool(today and schedule["start"] and schedule["start"] <= today <= schedule["end"])
    # TripUpdate
    uok = [r for r in u if r.get("ok")]
    res["tu_polls_ok"] = len(uok)
    res["tu_entities_median"] = med([r["n"] for r in uok])
    tu_trips = tu_with_delay = 0
    tu_vals = tu_nonzero = 0
    tu_ids = set()
    for r in uok:
        for row in r.get("u") or []:
            tu_trips += 1
            tu_ids.add(row[0])
            if row[4] is not None or any(s[2] is not None or s[4] is not None for s in row[5]):
                tu_with_delay += 1
            for s in row[5]:
                for v in (s[2], s[4]):
                    if v is not None:
                        tu_vals += 1
                        tu_nonzero += v != 0
    res["tu_with_delay_pct"] = pct(tu_with_delay, tu_trips)
    res["tu_delay_nonzero_pct"] = pct(tu_nonzero, tu_vals)
    if schedule and tu_ids:
        res["tu_trip_match_pct"] = pct(sum(1 for t in tu_ids if t in schedule["trip_ids"]), len(tu_ids))
    res["verdict"], res["verdict_reason"] = judge(res)
    return res


def judge(res):
    if res["polls"] == 0:
        return "データなし", "取得記録がない"
    if res["daytime_polls"] < GATE["min_daytime_polls"]:
        return "判定不能", f"日中（7〜19時）の取得が{res['daytime_polls']}回で、{GATE['min_daytime_polls']}回に満たない（夜間・短時間）"
    bad = []
    if (res["success_rate"] or 0) < GATE["success"] * 100:
        bad.append(f"取得成功率{res['success_rate']}%")
    if (res["vehicles_median_daytime"] or 0) < GATE["vehicles_median"]:
        bad.append(f"日中の車両数の中央値{res['vehicles_median_daytime']}台")
    pi = res.get("position_interval_s")
    if pi is None or pi > GATE["pos_interval_s"]:
        bad.append(f"位置更新間隔{pi}秒")
    tm = res.get("trip_match_active_pct")
    if tm is None or tm < GATE["trip_match"] * 100:
        bad.append(f"運行日のtrip_id一致率{tm}%")
    return ("不通過", "、".join(bad)) if bad else ("通過", "")


def _f(x):
    if x is None:
        return "—"
    return str(int(x)) if float(x) == int(x) else str(x)


def markdown_table(results, sources):
    """README に貼れる Markdown の表。事業者は名称順（優劣ではない）。"""
    gt = {s["dataset"]: bool(s.get("gtfs")) for s in sources}
    lines = ["| 事業者（データセット） | 取得成功 | 車両数 中央値/最大 | フィード更新間隔(秒) | 位置更新間隔(秒) | 静的GTFS | trip_id一致（全便/運行日） | TripUpdate 遅れ値あり/0以外 | 判定 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for m in sorted(results, key=lambda m: m["name"]):
        tm = "—" if m.get("trip_match_pct") is None else f"{_f(m['trip_match_pct'])}/{_f(m.get('trip_match_active_pct'))}%"
        tu = "—" if m.get("tu_with_delay_pct") is None else f"{_f(m['tu_with_delay_pct'])}/{_f(m.get('tu_delay_nonzero_pct'))}%"
        lines.append(f"| {m['name'].replace(chr(0x3000), ' ')[:40]} | {m['polls_ok']}/{m['polls']} | {_f(m['vehicles_median'])}/{_f(m['vehicles_max'])} | "
                     f"{_f(m['feed_interval_s'])} | {_f(m['position_interval_s'])} | {'あり' if gt.get(m['dataset']) else 'なし'} | {tm} | {tu} | {m['verdict']} |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true", help="結果を Markdown の表で出力")
    ap.add_argument("--raw-dir", default=str(ROOT / "data" / "raw"))
    ap.add_argument("--gtfs-dir", default=str(ROOT / "data" / "gtfs"))
    ap.add_argument("--day", default="", help="YYYYMMDD。指定すればその日の記録だけ測る")
    ap.add_argument("--out", default=str(ROOT / "data" / "quality.json"))
    a = ap.parse_args()
    src = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))
    out = []
    for s in src:
        recs = read_records(a.raw_dir, s["dataset"], a.day or None)
        if not recs:
            continue
        last = max(r["t"] for r in recs)
        today = dt.datetime.fromtimestamp(last, JST).date()
        gz = Path(a.gtfs_dir) / f"{s['dataset']}.zip"
        sched = load_schedule(str(gz), today, with_stop_times=False) if gz.exists() else None
        m = measure_dataset(recs, sched, today)
        m.update({"dataset": s["dataset"], "name": s["name"]})
        out.append(m)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.markdown:
        print(markdown_table(out, src))
        return
    print("事業者（データセット） | 取得 | 車両数(中央/最大) | 日中車両数 | 更新間隔s(feed/位置) | trip一致%(全/運行日) | TU遅れ% | 判定")
    for m in out:
        print(f"{m['name'][:28]} | {m['polls_ok']}/{m['polls']} | {m['vehicles_median']}/{m['vehicles_max']} | {m['vehicles_median_daytime']} | "
              f"{m['feed_interval_s']}/{m['position_interval_s']} | {m.get('trip_match_pct')}/{m.get('trip_match_active_pct')} | "
              f"{m['tu_with_delay_pct']} | {m['verdict']} {m['verdict_reason']}")


if __name__ == "__main__":
    main()
