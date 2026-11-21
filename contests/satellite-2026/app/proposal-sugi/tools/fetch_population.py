#!/usr/bin/env python3
"""e-Stat 地域メッシュ統計（令和2年国勢調査 250mメッシュ、統計表ID T001102、1次メッシュ 5339）を取得し、
対象範囲（+周辺 7km）の人口総数を pop_cells.json に書き出す（GET のみ）。
出力: <出力ディレクトリ>/pop_cells.json = {"cells": [[緯度, 経度, 人口], ...], "hidden": 秘匿セル数, "source": ...}
使い方: python3 -I tools/fetch_population.py <出力ディレクトリ>
"""
import csv, io, json, os, sys, urllib.request, zipfile

URL = 'https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code=5339&downloadType=2'
BBOX = (139.17, 35.76, 139.35, 35.88)
MARGIN = 0.07  # 度。約 6〜7 km


def mesh250_center(code):
    """10桁の地域メッシュコード（5次メッシュ=250m）の中心 (lat, lon)。"""
    p, u, q, v, r, w, m5, m25 = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7]), int(code[8]), int(code[9])
    lat = p * 40 / 60 + q * 5 / 60 + r * 30 / 3600 + (m5 in (3, 4)) * 15 / 3600 + (m25 in (3, 4)) * 7.5 / 3600
    lon = 100 + u + v * 7.5 / 60 + w * 45 / 3600 + (m5 in (2, 4)) * 22.5 / 3600 + (m25 in (2, 4)) * 11.25 / 3600
    return lat + 3.75 / 3600, lon + 5.625 / 3600


def main(out):
    os.makedirs(out, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=300) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    text = z.read(z.namelist()[0]).decode('cp932')
    rd = csv.reader(io.StringIO(text))
    next(rd); next(rd)  # 見出し2行
    cells, hidden = [], 0
    for row in rd:
        lat, lon = mesh250_center(row[0])
        if not (BBOX[0] - MARGIN <= lon <= BBOX[2] + MARGIN and BBOX[1] - MARGIN <= lat <= BBOX[3] + MARGIN):
            continue
        v = row[4].strip()
        if v.isdigit():
            cells.append([round(lat, 5), round(lon, 5), int(v)])
        else:
            hidden += 1  # '*' = 秘匿
    json.dump({'cells': cells, 'hidden': hidden, 'source': 'e-Stat T001102'}, open(os.path.join(out, 'pop_cells.json'), 'w'))
    print(len(cells), 'cells, hidden', hidden, 'pop', sum(c[2] for c in cells))


if __name__ == '__main__':
    main(sys.argv[1])
