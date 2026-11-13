#!/usr/bin/env python3
"""build_data.py の入力を取得する（GETのみ）。<作業ディレクトリ> に保存。

usage: python3 -I tools/fetch_raw.py <作業ディレクトリ>
  - 各自治体の AED CSV（tools/sources.json の csv_url）
  - 行政区域の境界 GeoJSON（Geoshape、国土数値情報の行政区域データ N03 を NII が加工。Geoshape は CC BY 4.0）
  - 地域メッシュ統計（e-Stat 統計GIS、1次メッシュ別 zip）
取得済みのファイルは再取得しない。
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = {"User-Agent": "udc2026-aed-night/0.1 (research; GET only)"}
GEOSHAPE = "https://geoshape.ex.nii.ac.jp/city/geojson/{year}/{pref}/{bid}.geojson"
MESH = "https://www.e-stat.go.jp/gis/statmap-search/data?statsId={sid}&code={code}&downloadType=2"


def get(url, dest):
    if dest.exists() and dest.stat().st_size > 0:
        print("既存", dest.name)
        return
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    print("取得", dest.name, len(data), "bytes")
    time.sleep(0.5)


def main():
    work = Path(sys.argv[1])
    work.mkdir(parents=True, exist_ok=True)
    src = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))
    for m in src["municipalities"]:
        get(m["csv_url"], work / f"aed_{m['id']}.csv")
        for bid in m["boundaries"]:
            get(GEOSHAPE.format(year=m["boundary_year"], pref=m["code"][:2], bid=bid), work / f"boundary_{bid}.geojson")
        get(MESH.format(sid=src["mesh_stats_id"], code=m["mesh1"]), work / f"mesh_{src['mesh_stats_id']}_{m['mesh1']}.zip")


if __name__ == "__main__":
    main()
