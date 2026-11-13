#!/usr/bin/env python3
"""窓の中心付近を含む撮影日ポリゴン（タイルの metadata/<tile>.geojson、約58MB）から、樹高マップの元画像の撮影日を調べる。

python3 -I tools/acq_date.py <lon> <lat> <work_dir>
GET のみ。<work_dir> に metadata を保存する（リポジトリ外の作業用ディレクトリを指定すること）。
結果は data/real.js の acq に手で反映する（build_real.py は日付を扱わない）。
"""
import json
import os
import sys
import urllib.request

TILE = "133002112"
URL = f"https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/metadata/{TILE}.geojson"


def inside(pt, ring):
    x, y = pt
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def main():
    lon, lat, work = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
    path = os.path.join(work, TILE + ".geojson")
    if not os.path.exists(path):
        with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "geo-campaign-2026"}), timeout=300) as r, open(path, "wb") as f:
            f.write(r.read())
    d = json.load(open(path, encoding="utf-8"))
    print("ポリゴン数", len(d["features"]))
    offs = [(0, 0), (0.008, 0.006), (-0.008, 0.006), (0.008, -0.006), (-0.008, -0.006)]
    for dx, dy in offs:
        p = (lon + dx, lat + dy)
        hits = []
        for f in d["features"]:
            g = f["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
            for poly in polys:
                xs = [c[0] for c in poly[0]]
                ys = [c[1] for c in poly[0]]
                if min(xs) <= p[0] <= max(xs) and min(ys) <= p[1] <= max(ys) and inside(p, poly[0]):
                    hits.append(f["properties"].get("acq_date"))
                    break
        print(p, hits)


if __name__ == "__main__":
    main()
