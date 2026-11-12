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
from array import array
from pathlib import Path

from .delay import norm_ts
from .gtfs import load_schedule

ROOT = Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
DAY_HOURS = range(7, 19)
GATE = {"success": 0.95, "vehicles_median": 5, "pos_interval_s": 90, "trip_match": 0.90, "min_daytime_polls": 10}


def iter_records(raw_dir, dataset, day=None):
    """data/raw/<dataset>/*.jsonl を 1 行ずつ読む（全体をメモリに載せない）。"""
    d = Path(raw_dir) / dataset
    if not d.exists():
        return
    for f in sorted(d.glob("*.jsonl")):
        if day and f.stem != day:
            continue
        with f.open(encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    try:
                        yield json.loads(line)
                    except ValueError:
                        pass


class RecordStream:
    """何度でも先頭から読み直せる記録の列（iter_records を包む）。"""

    def __init__(self, raw_dir, dataset, day=None):
        self.args = (raw_dir, dataset, day)

    def __iter__(self):
        return iter_records(*self.args)


def read_records(raw_dir, dataset, day=None):
    return list(iter_records(raw_dir, dataset, day))


def last_record_time(raw_dir, dataset):
    """最後の jsonl ファイルだけを読んで、記録の最後の時刻（epoch 秒）を返す。なければ None。"""
    d = Path(raw_dir) / dataset
    files = sorted(d.glob("*.jsonl")) if d.exists() else []
    for f in reversed(files):
        ts = [r.get("t") for r in iter_records(raw_dir, dataset, f.stem) if r.get("t")]
        if ts:
            return max(ts)
    return None


def med(xs):
    return statistics.median(xs) if xs else None


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def measure_dataset(recs, schedule=None, today=None):
    """recs: 記録（時刻順）の反復可能なもの（リストでも iter_records でもよい。1 回だけ読む）。
    schedule: load_schedule の結果（なければ一致率は None）。"""
    polls = 0
    n_ok = 0
    first_t = last_t = None
    obs_days = set()
    hours_ok_day = 0
    counts, day_counts = array("l"), array("l")
    fts = set()
    same_ft = 0
    seen, ages, diffs = {}, array("l"), array("l")
    trips_seen, vehicles = set(), set()
    with_trip = rows_n = stop_hit = stop_rows = 0
    tu_polls_ok = 0
    tu_n = array("l")
    tu_trips = tu_with_delay = tu_vals = tu_nonzero = 0
    tu_ids = set()
    for r in recs:
        kind = r["kind"]
        if kind == "v":
            polls += 1
            t = r["t"]
            first_t = t if first_t is None else min(first_t, t)
            last_t = t if last_t is None else max(last_t, t)
            if not r.get("ok"):
                continue
            n_ok += 1
            d = dt.datetime.fromtimestamp(t, JST)
            obs_days.add(d.strftime("%Y-%m-%d"))
            counts.append(r["n"])
            if d.hour in DAY_HOURS:
                hours_ok_day += 1
                day_counts.append(r["n"])
            if r.get("ft"):
                fts.add(r["ft"])
            same_ft += 1 if r.get("same") else 0
            for row in r.get("v") or []:
                vid, trip, route, sdate, lat, lon, ts, seq, sid = row
                ts = norm_ts(ts)
                rows_n += 1
                vehicles.add(vid)
                if trip:
                    with_trip += 1
                    trips_seen.add(trip)
                if ts:
                    ages.append(t - ts)
                    if vid in seen and ts != seen[vid]:
                        diffs.append(ts - seen[vid])
                    seen[vid] = ts
                if sid and schedule:
                    stop_rows += 1
                    stop_hit += sid in schedule["stops"]
        elif kind == "u" and r.get("ok"):
            tu_polls_ok += 1
            tu_n.append(r["n"])
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
    res = {"polls": polls, "polls_ok": n_ok, "success_rate": pct(n_ok, polls)}
    res["daytime_polls"] = hours_ok_day
    if polls:
        res["first"] = dt.datetime.fromtimestamp(first_t, JST).strftime("%Y-%m-%d %H:%M")
        res["last"] = dt.datetime.fromtimestamp(last_t, JST).strftime("%Y-%m-%d %H:%M")
    res["first_t"], res["last_t"], res["observed_days"] = first_t, last_t, sorted(obs_days)
    res["vehicles_median"] = med(counts)
    res["vehicles_max"] = max(counts) if counts else None
    res["vehicles_median_daytime"] = med(day_counts)
    # フィード時刻の更新間隔
    fts = sorted(fts)
    res["feed_interval_s"] = med([b - a for a, b in zip(fts, fts[1:])])
    res["same_ft_share"] = pct(same_ft, n_ok)
    res["position_interval_s"] = med([d for d in diffs if d > 0])
    res["position_age_s"] = med(ages)
    res["vehicle_rows"] = rows_n
    res["trip_id_present_pct"] = pct(with_trip, rows_n)
    res["distinct_trips"] = len(trips_seen)
    res["distinct_vehicles"] = len(vehicles)
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
    res["tu_polls_ok"] = tu_polls_ok
    res["tu_entities_median"] = med(tu_n)
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
        recs = RecordStream(a.raw_dir, s["dataset"], a.day or None)
        last = max((r["t"] for r in recs if r.get("t")), default=None)
        if last is None:
            continue
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
