#!/usr/bin/env python3
"""全国森林資源メッシュ（20m、関東の図郭 gpkg）のうち、林種=人工林・森林簿樹種1=スギ のメッシュを、500mメッシュ（地域メッシュ4次）に集計する。
同時に、各20mメッシュの位置の平均傾斜角度（国土数値情報 G04-d 標高・傾斜度5次メッシュ、250m）を引いて、500mメッシュごとの平均にする。

入力（第1引数 RAW）: RAW/mesh/<図郭>/*.gpkg（tools/kanto_fetch_mesh.py の出力）、RAW/g04/<1次メッシュ>/*.shp（国土数値情報 G04-d-11）
出力: RAW/agg.json  {"cells": [[iy, ix, n, n26, n21, nunk, slope_sum, ...], ...], "stats": {...}}
  iy = floor(緯度*240)、ix = floor(経度*160)（500m = 15秒×22.5秒）。n 等は20mメッシュの数（1個 = 0.04 ha）。
  林齢は森林簿の値（森林簿年月日時点。今年の林齢ではない）。n26 = 林齢26以上、n21 = 21以上、nunk = 林齢なし。
numpy / pyproj / fiona が必要。使い方: python3 -I tools/kanto_aggregate.py RAW
"""
import collections, glob, json, os, sqlite3, sys

import numpy as np
from pyproj import Transformer

TO_LL = Transformer.from_crs(6677, 4326, always_xy=True)
G_LON0, G_DLON = 138.0, 0.003125          # 5次メッシュ（250m）の格子
G_LAT0, G_DLAT = 34.0 + 40.0 / 60.0, 1.0 / 480.0
G_W, G_H = 960, 1280


def load_slope(raw):
    import fiona
    grid = np.full((G_H, G_W), np.nan, dtype=np.float32)
    for shp in sorted(glob.glob(os.path.join(raw, 'g04', '*', '*.shp'))):
        with fiona.open(shp) as s:
            for f in s:
                v = f['properties'].get('G04d_010')
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                xs = [c[0] for c in f['geometry']['coordinates'][0]]
                ys = [c[1] for c in f['geometry']['coordinates'][0]]
                ix = int(round((min(xs) - G_LON0) / G_DLON)); iy = int(round((min(ys) - G_LAT0) / G_DLAT))
                if 0 <= ix < G_W and 0 <= iy < G_H:
                    grid[iy, ix] = v
    return grid


def tile_cells(path):
    c = sqlite3.connect(path)
    t = c.execute("select table_name from gpkg_contents where data_type='features'").fetchone()[0]
    rows = c.execute('select substr(geom,9,32), 林齢, 森林簿年月日 from "%s" where 林種=? and 森林簿樹種1=?' % t, ('人工林', 'スギ')).fetchall()
    tot = c.execute('select count(*) from "%s"' % t).fetchone()[0]
    c.close()
    return rows, tot


def main(raw):
    grid = load_slope(raw)
    print('slope grid filled', int(np.isfinite(grid).sum()), flush=True)
    acc = collections.defaultdict(lambda: [0, 0, 0, 0, 0.0, 0])  # n, n26, n21, nunk, slope_sum, slope_n
    seen = []
    vint = collections.Counter()
    tiles = sorted(glob.glob(os.path.join(raw, 'mesh', '*', '*.gpkg')))
    total_all = 0
    for p in tiles:
        rows, tot = tile_cells(p)
        total_all += tot
        if not rows:
            continue
        env = np.frombuffer(b''.join(r[0] for r in rows), dtype='<f8').reshape(-1, 4)
        x = (env[:, 0] + env[:, 1]) / 2; y = (env[:, 2] + env[:, 3]) / 2
        age = np.array([(-1 if r[1] is None else r[1]) for r in rows])
        for r in rows:
            vint[(r[2] or '')[:4]] += 1
        seen.append(np.floor(x / 20).astype(np.int64) * 10_000_000 + np.floor(y / 20).astype(np.int64))
        lon, lat = TO_LL.transform(x, y)
        gx = np.floor((lon - G_LON0) / G_DLON).astype(int); gy = np.floor((lat - G_LAT0) / G_DLAT).astype(int)
        ok = (gx >= 0) & (gx < G_W) & (gy >= 0) & (gy < G_H)
        sl = np.full(len(lon), np.nan); sl[ok] = grid[gy[ok], gx[ok]]
        key = np.floor(lat * 240).astype(np.int64) * 100000 + np.floor(lon * 160).astype(np.int64)
        uk, inv = np.unique(key, return_inverse=True)
        n = np.bincount(inv); n26 = np.bincount(inv, weights=(age >= 26)); n21 = np.bincount(inv, weights=(age >= 21))
        nunk = np.bincount(inv, weights=(age < 0))
        fin = np.isfinite(sl)
        ss = np.bincount(inv, weights=np.where(fin, sl, 0.0)); sn = np.bincount(inv, weights=fin)
        for i, k in enumerate(uk.tolist()):
            a = acc[k]
            a[0] += int(n[i]); a[1] += int(n26[i]); a[2] += int(n21[i]); a[3] += int(nunk[i]); a[4] += float(ss[i]); a[5] += int(sn[i])
        print(os.path.basename(p), len(rows), flush=True)
    allk = np.concatenate(seen)
    dup = int(len(allk) - len(np.unique(allk)))
    cells = [[k // 100000, k % 100000] + a for k, a in sorted(acc.items())]
    json.dump({'cells': cells, 'stats': {'tiles': len(tiles), 'sugi_cells20': int(len(allk)), 'dup20': dup, 'all_cells20': total_all,
                                         'vintage': dict(vint)}}, open(os.path.join(raw, 'agg.json'), 'w'))
    print('cells500', len(cells), 'sugi20', len(allk), 'dup', dup)


if __name__ == '__main__':
    main(sys.argv[1])
