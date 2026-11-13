"""CC BY のバス位置データ（GTFS-RT）を一定間隔で取得して保存する。GET のみ・トークン不要。

    python3 -m teiji.collect --once                         # 1回だけ全事業者
    python3 -m teiji.collect --interval 60 --duration 3600  # 60秒おきに1時間（手動実行）
    python3 -m teiji.collect --only odpt_gunma_bus_all_lines,b_bus_gtfs_rt-toei --once

常駐はしない（--duration で必ず止まる）。cron 等の設定はこのリポジトリに置かない。
保存先 data/raw/<dataset>/<YYYYMMDD>.jsonl（日本時間の取得日）。1行=1回の取得:
  {"t": 取得時刻(epoch秒), "kind": "v"|"u", "ok": true, "ft": フィード時刻, "bytes": N, "n": 件数,
   "same": 1（前回と同じ ft のとき。中身は省略）,
   "v": [[車両ID, trip_id, route_id, 運行日, lat, lon, 位置時刻, stop_sequence, stop_id], ...]   # kind=v
   "u": [[trip_id, route_id, 運行日, 時刻, trip全体のdelay, [[seq, stop_id, 到着delay, 到着time, 出発delay, 出発time], ...]], ...]  # kind=u
  } 失敗時は {"t":..., "kind":..., "ok": false, "err": "..."}
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import time
import urllib.request
from pathlib import Path

from . import gtfsrt

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "bus-teiji-karte/0.1 (research; GET only; contact via repository owner)"}
JST = dt.timezone(dt.timedelta(hours=9))


def load_sources(only=None):
    src = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))
    if only:
        src = [s for s in src if s["dataset"] in only]
    return src


def fetch_pb(url, timeout=30):
    req = urllib.request.Request(url, headers=UA, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def compact_vehicles(feed):
    rows = []
    for e in feed["entities"]:
        v = e.get("vehicle")
        if not v:
            continue
        tr, pos, vd = v.get("trip", {}), v.get("position", {}), v.get("vehicle", {})
        if "lat" not in pos or "lon" not in pos:
            continue
        rows.append([vd.get("id") or e.get("id"), tr.get("trip_id"), tr.get("route_id"), tr.get("start_date"),
                     round(pos["lat"], 6), round(pos["lon"], 6), v.get("timestamp"),
                     v.get("current_stop_sequence"), v.get("stop_id")])
    return rows


def compact_updates(feed):
    rows = []
    for e in feed["entities"]:
        u = e.get("trip_update")
        if not u:
            continue
        tr = u.get("trip", {})
        stops = []
        for s in u.get("stop_time_update", []):
            a, d = s.get("arrival", {}), s.get("departure", {})
            stops.append([s.get("stop_sequence"), s.get("stop_id"), a.get("delay"), a.get("time"), d.get("delay"), d.get("time")])
        rows.append([tr.get("trip_id"), tr.get("route_id"), tr.get("start_date"), u.get("timestamp"), u.get("delay"), stops])
    return rows


def snapshot(url, kind, last_ft):
    """1回取得して保存用の dict を返す。last_ft は前回の feed 時刻（同じなら中身を省略）。"""
    t = int(time.time())
    try:
        raw = fetch_pb(url)
        feed = gtfsrt.parse_feed(raw)
    except Exception as e:  # noqa: BLE001 - 取得・解析の失敗は記録して続行
        return {"t": t, "kind": kind, "ok": False, "err": f"{type(e).__name__}: {e}"[:200]}
    rec = {"t": t, "kind": kind, "ok": True, "ft": feed["timestamp"], "bytes": len(raw), "n": feed["n_entities"]}
    if last_ft is not None and feed["timestamp"] == last_ft:
        rec["same"] = 1
        return rec
    rec["v" if kind == "v" else "u"] = compact_vehicles(feed) if kind == "v" else compact_updates(feed)
    return rec


def append(dataset, rec, raw_dir):
    day = dt.datetime.fromtimestamp(rec["t"], JST).strftime("%Y%m%d")
    d = raw_dir / dataset
    d.mkdir(parents=True, exist_ok=True)
    with (d / f"{day}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")


def run(sources, interval, duration, with_trip_updates, raw_dir, once=False, workers=8, log=print):
    last = {}
    end = time.time() + duration
    n = 0
    while True:
        started = time.time()
        jobs = []
        for s in sources:
            if s.get("vehicle"):
                jobs.append((s["dataset"], "v", s["vehicle"]))
            if with_trip_updates and s.get("trip_update"):
                jobs.append((s["dataset"], "u", s["trip_update"]))
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(snapshot, url, kind, last.get((ds, kind))): (ds, kind) for ds, kind, url in jobs}
            for f in cf.as_completed(futs):
                ds, kind = futs[f]
                rec = f.result()
                if rec.get("ok"):
                    last[(ds, kind)] = rec["ft"]
                append(ds, rec, raw_dir)
        n += 1
        ok = sum(1 for k in last)
        log(f"[{dt.datetime.now(JST):%H:%M:%S}] 取得 {n} 回目: {len(jobs)} 件中 応答あり {ok} 件")
        if once or time.time() + interval > end:
            break
        time.sleep(max(0, interval - (time.time() - started)))
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interval", type=int, default=60, help="取得間隔（秒）。既定60、最小15")
    ap.add_argument("--duration", type=int, default=600, help="動かす長さ（秒）。この時間で必ず止まる")
    ap.add_argument("--once", action="store_true", help="1回だけ取得")
    ap.add_argument("--only", default="", help="dataset ID をカンマ区切りで指定")
    ap.add_argument("--no-trip-updates", action="store_true", help="TripUpdate を取らない")
    ap.add_argument("--raw-dir", default=str(ROOT / "data" / "raw"))
    a = ap.parse_args()
    only = [x for x in a.only.split(",") if x]
    run(load_sources(only), max(15, a.interval), a.duration, not a.no_trip_updates, Path(a.raw_dir), once=a.once)


if __name__ == "__main__":
    main()
