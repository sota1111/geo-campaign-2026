"""ビルド: 公開データを取得して web/data/kankou.json と route_hour.csv を作る。

  python3 -m kankou.build [--today YYYY-MM-DD] [--refresh] [--cache DIR]

基準日: 各フィードの有効期間内で、today 以降の最初の水曜（平日）と日曜（休日）。
"""
import argparse
import csv
import datetime as dt
import io
import json
import sys
import zipfile
from pathlib import Path

from . import fetch, gtfs, model, sources

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = 1
DAYTYPE_JA = {"wd": "平日", "hol": "休日"}


def load_region(path=None):
    return json.loads(Path(path or ROOT / "region.json").read_text(encoding="utf-8"))


def assemble(region, feed_blobs, ksj, today):
    """純粋関数: 取得済みデータから出力 dict を作る。

    feed_blobs: {feed key: zip バイト列}、ksj: {tourist, hospital, school, station: zip パス}
    """
    bbox = region["bbox"]
    feeds, feed_meta = [], []
    for f in region["feeds"]:
        d = gtfs.load_feed(feed_blobs[f["key"]], bbox, today)
        feeds.append({"key": f["key"], "name": f["name"], "data": d})
        feed_meta.append({
            "key": f["key"], "name": f["name"], "operator": f["operator"], "license": f["license"],
            "license_url": f["license_url"], "page": f["page"], "url": f["url"],
            "start": d["start"].isoformat() if d["start"] else None,
            "end": d["end"].isoformat() if d["end"] else None,
            "ref": {k: v.isoformat() for k, v in d["ref"].items()},
            "version": d["version"], "expired": d["expired"],
            "trips": len(d["trips"]),
        })
    stops, routes, patterns = model.build_patterns(feeds)
    spots = sources.read_tourist_spots(ksj["tourist"], bbox)
    tstop = model.tourist_stops(stops, spots)
    summary = model.route_summary(stops, routes, patterns, tstop)
    table = model.hourly_table(routes, patterns, tstop)
    facilities = (sources.read_hospitals(ksj["hospital"], bbox) + sources.read_schools(ksj["school"], bbox)
                  + sources.read_rail_stations(ksj["station"], bbox))
    return {
        "schema": SCHEMA,
        "built": today.isoformat(),
        "region": {"id": region["id"], "name": region["name"], "bbox": bbox, "reason": region["reason"]},
        "near_m": model.NEAR_M,
        "feeds": feed_meta,
        "stops": [[round(s["lat"], 5), round(s["lon"], 5), s["name"], s["feed"]] for s in stops],
        "spots": [[s["lat"], s["lon"], s["name"], s["kind"]] for s in spots],
        "tstop": {str(i): v[0] for i, v in sorted(tstop.items())},
        "routes": [{"name": r["name"], "feed": r["feed"], "stops": s["stops"], "tstops": s["tstops"],
                    "share": s["share"], "spots": s["spots"], "trips_wd": s["trips_wd"], "trips_hol": s["trips_hol"]}
                   for r, s in zip(routes, summary)],
        "patterns": [[p["route"], p["stops"], p["off"], p["dep"]["wd"], p["dep"]["hol"]] for p in patterns],
        "table": [[t["route"], t["dt"], t["hour"], t["trips"], t["visits"]] for t in table],
        "facilities": [[f["lat"], f["lon"], f["name"], f["kind"]] for f in facilities],
    }


def to_csv(data):
    """系統×時間帯の一覧（観光地点に近い停留所に停車する便）。画面のCSV出力と同じ列。"""
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["系統", "事業者フィード", "日種別", "時間帯(時)", "観光地点に近い停留所へ停車する便数",
                "観光地点に近い停留所への停車回数", "系統の停留所のうち観光地点に近い割合(%)", "系統が近くを通る観光地点"])
    feeds = {f["key"]: f["name"] for f in data["feeds"]}
    for r, d, h, trips, visits in data["table"]:
        rt = data["routes"][r]
        names = "・".join(data["spots"][i][2] for i in rt["spots"])
        w.writerow([rt["name"], feeds[rt["feed"]], DAYTYPE_JA[d], h, trips, visits, round(rt["share"] * 100, 1), names])
    return out.getvalue()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=None)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--cache", default=str(ROOT / "cache"))
    ap.add_argument("--out", default=str(ROOT / "web" / "data"))
    a = ap.parse_args(argv)
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    region = load_region()
    cache = Path(a.cache)
    blobs = {}
    for f in region["feeds"]:
        p = fetch.cached(cache / "gtfs" / f"{f['key']}.zip", f["url"], a.refresh)
        zipfile.ZipFile(p).testzip()
        blobs[f["key"]] = p.read_bytes()
    ksj = {}
    for k, url in region["ksj"].items():
        ksj[k] = fetch.cached(cache / "ksj" / url.rsplit("/", 1)[1], url, a.refresh)
    data = assemble(region, blobs, ksj, today)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "kankou.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "route_hour.csv").write_text("﻿" + to_csv(data), encoding="utf-8", newline="")
    print(f"stops={len(data['stops'])} routes={len(data['routes'])} patterns={len(data['patterns'])} "
          f"spots={len(data['spots'])} tstops={len(data['tstop'])} facilities={len(data['facilities'])} table={len(data['table'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
