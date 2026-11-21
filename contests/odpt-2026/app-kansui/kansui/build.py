"""データを集めて web/data/kansui.json を作る。

  python3 -m kansui.build            （app-kansui/ で実行。取得は GET のみ。cache/ にあれば再利用）
必要: Python 3.9+、Pillow（タイル画像の色の読み取り）。
"""
import datetime as dt
import json
import os
import sys
import urllib.request

from . import gtfs, hazard, osm
from .analysis import AVOID_MIN, WARN_MIN, build_dataset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
OUT = os.path.join(ROOT, "web", "data", "kansui.json")

REGION = {
    "id": "tokyo-23ku-center-east",
    "name": "東京都区部の中央部〜東部（千代田・中央・港・新宿・文京・台東・墨田・江東・江戸川西部などの駅周辺）",
    "bbox": [35.63, 139.70, 35.74, 139.88],  # 南, 西, 北, 東
    "center": [139.79, 35.685],
}

SOURCES = [
    {"id": "gtfs", "name": "都営バス GTFS-JP（公共交通オープンデータセンター）", "org": "東京都交通局・公共交通オープンデータ協議会",
     "license": "CC BY 4.0", "url": "https://ckan.odpt.org/dataset/b_bus_gtfs_jp-toei",
     "use": "バス停の位置、平日・休日の運行本数、時間帯別の便数"},
    {"id": "osm", "name": "OpenStreetMap（駅・出入口の位置）", "org": "© OpenStreetMap contributors",
     "license": "ODbL 1.0", "url": "https://www.openstreetmap.org/copyright",
     "use": "駅と地下鉄・鉄道駅の出入口の位置"},
    {"id": "flood", "name": "洪水浸水想定区域（想定最大規模）", "org": "国土交通省各地方整備局等・東京都（国土地理院「重ねるハザードマップ」のタイル）",
     "license": "国土地理院 重ねるハザードマップのオープンデータ利用規約（出典明記）", "url": "https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html",
     "use": "出入口・バス停の地点の浸水想定の深さの区分"},
    {"id": "tide", "name": "高潮浸水想定区域（想定最大規模）", "org": "東京都（国土地理院「重ねるハザードマップ」のタイル）",
     "license": "国土地理院 重ねるハザードマップのオープンデータ利用規約（出典明記）", "url": "https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html",
     "use": "同上"},
    {"id": "base", "name": "地理院タイル（淡色地図）", "org": "国土地理院",
     "license": "地理院タイル利用規約", "url": "https://maps.gsi.go.jp/development/ichiran.html", "use": "背景地図"},
]


def download(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=hazard.UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


def main():
    bbox = tuple(REGION["bbox"])
    osm_data = osm.fetch(bbox, os.path.join(CACHE, "osm_overpass.json"))
    stations, entrances = osm.parse(osm_data)
    zpath = os.path.join(CACHE, "toeibus_gtfs.zip")
    download(gtfs.URL, zpath)
    pad = 0.012
    gb = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    bus, gmeta = gtfs.load_bus_stops(zpath, gb)
    sampler = hazard.Sampler(os.path.join(CACHE, "tiles"))
    ds = build_dataset(stations, entrances, bus, sampler)
    st = ds["stations"]
    meta = {
        "generated": dt.date.today().isoformat(),
        "region": REGION,
        "classes": hazard.CLASS_LABELS,
        "avoid_min": AVOID_MIN, "warn_min": WARN_MIN,
        "gtfs": gmeta,
        "sources": SOURCES,
        "counts": {"stations": len(st), "entrances": sum(len(s["entrances"]) for s in st),
                   "bus_stops": len(ds["bus"]), "unassigned_entrances": ds["unassigned_entrances"]},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "stations": st, "bus": ds["bus"]}, f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(meta["counts"], ensure_ascii=False), "->", OUT)


if __name__ == "__main__":
    sys.exit(main())
