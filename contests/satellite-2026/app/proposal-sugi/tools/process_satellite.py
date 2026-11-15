#!/usr/bin/env python3
"""Sentinel-2 L2A（Element 84 Earth Search の公開 COG、GET のみ）から、スギ植林を含む各区画の
冬（常緑樹だけが緑を保つ時期）と夏の NDVI の平均を求める。

処理: 冬 / 夏それぞれで雲量の少ない1シーンを選び、赤(B04)・近赤外(B08)・シーン分類(SCL)を対象範囲だけ読み込み、
雲・影・雪などの画素を除いて NDVI=(B08-B04)/(B08+B04) を作り、区画ごとの「スギ植林の部分」だけで平均する。
出力: <出力ディレクトリ>/ndvi.json = {"scenes": {...}, "cells": {メッシュコード: {"w": 冬NDVI, "s": 夏NDVI, "nw": 冬の有効画素数, "ns": 夏の有効画素数}}}
使い方: PYTHONPATH=<依存の入った場所> python3 tools/process_satellite.py <veg_raw.json> <出力ディレクトリ>
依存: rasterio, shapely, pyproj, numpy（tools/requirements.txt）
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import rasterio
from rasterio import features
from rasterio.windows import from_bounds
from shapely.geometry import mapping

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cells as C  # noqa: E402

STAC = 'https://earth-search.aws.element84.com/v1/search'
TILE = '54SUE'
SEASONS = {'w': ('2025-01-01T00:00:00Z', '2025-02-28T23:59:59Z'), 's': ('2025-07-15T00:00:00Z', '2025-09-15T23:59:59Z')}
BAD_SCL = (0, 1, 3, 8, 9, 10, 11)  # 欠測・飽和・雲影・雲(中/高確率)・薄雲・雪氷


def pick_scene(start, end):
    bb = C.BBOX
    q = {'collections': 'sentinel-2-l2a', 'bbox': ','.join(map(str, bb)), 'datetime': start + '/' + end, 'limit': 50}
    with urllib.request.urlopen(STAC + '?' + urllib.parse.urlencode(q), timeout=60) as r:
        items = json.load(r)['features']
    items = [i for i in items if TILE in i['id']]
    items.sort(key=lambda i: i['properties']['eo:cloud_cover'])
    return items[0]


def read_band(url, bounds_utm, ref=None):
    with rasterio.open(url) as ds:
        win = from_bounds(*bounds_utm, transform=ds.transform).round_offsets().round_lengths()
        arr = ds.read(1, window=win)
        return arr, ds.window_transform(win)


def main(veg, out):
    sugi = C.load_sugi(veg)
    cells = C.build_cells(sugi)
    codes = sorted(cells)
    xs = [c for k in codes for c in cells[k]['geom_utm'].bounds[0::2]]
    ys = [c for k in codes for c in cells[k]['geom_utm'].bounds[1::2]]
    bounds = (min(xs) - 20, min(ys) - 20, max(xs) + 20, max(ys) + 20)
    res = {'scenes': {}, 'cells': {k: {} for k in codes}}
    for season, (a, b) in SEASONS.items():
        it = pick_scene(a, b)
        res['scenes'][season] = {'id': it['id'], 'date': it['properties']['datetime'][:10], 'cloud_cover': it['properties']['eo:cloud_cover']}
        red, tr = read_band(it['assets']['red']['href'], bounds)
        nir, _ = read_band(it['assets']['nir']['href'], bounds)
        scl, _ = read_band(it['assets']['scl']['href'], bounds)  # SCL は 20m。10m に拡大して重ねる
        scl = np.kron(scl, np.ones((2, 2), dtype=scl.dtype))[: red.shape[0], : red.shape[1]]
        if scl.shape != red.shape:
            pad = np.zeros(red.shape, dtype=scl.dtype)
            pad[: scl.shape[0], : scl.shape[1]] = scl
            scl = pad
        red = red.astype('float32'); nir = nir.astype('float32')
        valid = ~np.isin(scl, BAD_SCL) & ((red + nir) > 0)
        ndvi = np.where(valid, (nir - red) / np.where(red + nir == 0, 1, red + nir), np.nan)
        shapes = [(mapping(cells[k]['geom_utm']), i + 1) for i, k in enumerate(codes)]
        ids = features.rasterize(shapes, out_shape=red.shape, transform=tr, fill=0, dtype='int32', all_touched=False)
        for i, k in enumerate(codes):
            v = ndvi[ids == i + 1]
            v = v[~np.isnan(v)]
            res['cells'][k]['n' + season] = int(v.size)
            res['cells'][k][season] = round(float(v.mean()), 3) if v.size >= 20 else None
        print(season, it['id'], it['properties']['eo:cloud_cover'])
    os.makedirs(out, exist_ok=True)
    json.dump(res, open(os.path.join(out, 'ndvi.json'), 'w'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
