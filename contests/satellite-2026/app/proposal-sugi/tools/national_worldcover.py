#!/usr/bin/env python3
"""衛星由来の樹木被覆（ESA WorldCover 2021 v200、10m、Sentinel-1・Sentinel-2 から作られた土地被覆図、CC BY 4.0）から、
1kmの格子（経度 1/80度 × 緯度 1/120度）ごとの「樹木被覆（クラス10）の画素の割合」を作る。取得は GET のみ（認証なし）。
COG の概観（オーバービュー、既定は 1/16 = 約133m の画素）だけを読むので、全国でも数百MBの転送で済む。概観は元の画素を間引いた標本なので、
割合は標本からの推定値（1kmあたり 約60画素）。
使い方: python3 -I tools/national_worldcover.py <作業ディレクトリ> [概観の段=4（2,4,8,16,32,64 のインデックス。4 → 1/32、3 → 1/16）]
出力: <作業>/wc_tree.json  {"cells": [[gy, gx, 標本数, 樹木被覆の数], ...]}（gy = floor(緯度*120)、gx = floor(経度*80)。標本数が0のセルは出さない）
rasterio・numpy が必要。出典: ESA WorldCover 2021 v200 https://esa-worldcover.org/ （CC BY 4.0、© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021)）
"""
import json, os, sys, time

import numpy as np
import rasterio

BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_%s%02d%s%03d_Map.tif'


def tile_url(lat0, lon0):
    return BASE % ('N' if lat0 >= 0 else 'S', abs(lat0), 'E' if lon0 >= 0 else 'W', abs(lon0))


def read_tile(url, level):
    with rasterio.open(url) as d:
        ov = d.overviews(1)
        f = ov[level]
        h, w = -(-d.height // f), -(-d.width // f)
        a = d.read(1, out_shape=(h, w))  # 概観の画素（既定の最近傍で読む）
        b = d.bounds
    return a, b, h, w


def main(work, level=3):
    os.makedirs(work, exist_ok=True)
    acc = {}
    ok = 0
    for lat0 in range(24, 46, 3):          # 24〜45（3度刻みの南端）
        for lon0 in range(123, 156, 3):    # 123〜155
            url = tile_url(lat0, lon0)
            for k in range(3):
                try:
                    a, b, h, w = read_tile(url, level)
                    break
                except rasterio.errors.RasterioIOError as e:
                    if 'HTTP response code: 404' in str(e) or 'not recognized' in str(e) or 'No such file' in str(e):
                        a = None; break
                    time.sleep(3)
            else:
                a = None
            if a is None:
                continue
            ok += 1
            ys = b.top - (np.arange(h) + 0.5) * (b.top - b.bottom) / h
            xs = b.left + (np.arange(w) + 0.5) * (b.right - b.left) / w
            gy = np.floor(ys * 120).astype(np.int64)[:, None] * np.ones((1, w), dtype=np.int64)
            gx = np.ones((h, 1), dtype=np.int64) * np.floor(xs * 80).astype(np.int64)[None, :]
            land = a != 80  # 水域は標本数に数えない
            key = (gy * 100000 + gx)[land]
            tree = (a == 10)[land]
            uk, inv = np.unique(key, return_inverse=True)
            n = np.bincount(inv); t = np.bincount(inv, weights=tree)
            for kk, nn, tt in zip(uk.tolist(), n.tolist(), t.tolist()):
                v = acc.setdefault(kk, [0, 0])
                v[0] += nn; v[1] += int(tt)
            print(url[-30:], 'ok', flush=True)
    cells = [[k // 100000, k % 100000, v[0], v[1]] for k, v in sorted(acc.items())]
    json.dump({'cells': cells, 'tiles': ok, 'level': level}, open(os.path.join(work, 'wc_tree.json'), 'w'))
    print('tiles', ok, 'cells', len(cells))


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3)
