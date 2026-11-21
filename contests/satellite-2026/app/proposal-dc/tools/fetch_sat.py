#!/usr/bin/env python3
"""Sentinel-2 L2A（AWS Open Data）と Landsat 9 Collection 2 Level-2（Microsoft Planetary Computer の公開 Blob）の
必要な窓だけを HTTP Range 付き GET で取得し、CACHE_DIR に npz で置く。POST・認証・APIキーなし。
（Planetary Computer の読み取り用の期限付きトークンも GET で受け取る。無料・登録不要）
場面は固定（README の表と lib.js の SCENES に同じ）。
usage: python3 -I tools/fetch_sat.py CACHE_DIR
"""
import json
import os
import sys
import urllib.request

import numpy as np
import pyproj

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cog_window import Cog  # noqa: E402

BBOX = (130.63, 33.69, 130.91, 33.93)  # west, south, east, north
S2_BASE = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/52/S/FC/%s/%s/%s/'
S2 = {
    's2_now': ('2026', '8', 'S2B_52SFC_20260823_0_L2A', ['B02', 'B03', 'B04', 'B08', 'B11', 'SCL']),
    's2_past': ('2020', '8', 'S2B_52SFC_20200824_0_L2A', ['B04', 'B08', 'B11', 'SCL']),
}
LS_ID = 'LC09_L2SP_113036_20260822_20260823_02_T1'
LS_BASE = ('https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/2026/113/036/'
           'LC09_L2SP_113036_20260822_20260823_02_T1/LC09_L2SP_113036_20260822_20260823_02_T1_%s.TIF')
SAS = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/landsateuwest/landsat-c2'


def utm_box(margin=300.0):
    t = pyproj.Transformer.from_crs(4326, 32652, always_xy=True)
    w, s, e, n = BBOX
    xs, ys = zip(*[t.transform(x, y) for x in (w, e) for y in (s, n)])
    return min(xs) - margin, max(ys) + margin, max(xs) + margin, min(ys) - margin  # 西・北・東・南


def save(cache, name, cog, box):
    a, ox, oy = cog.window(*box)
    np.savez_compressed(os.path.join(cache, name + '.npz'), a=a, ox=ox, oy=oy, px=cog.scale[0])
    print(name, a.shape, 'px', cog.scale[0])


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    box = utm_box()
    for key, (yr, mo, sid, bands) in S2.items():
        for b in bands:
            p = os.path.join(cache, f'{key}_{b}.npz')
            if not os.path.exists(p):
                save(cache, f'{key}_{b}', Cog(S2_BASE % (yr, mo, sid) + b + '.tif'), box)
    tok = json.load(urllib.request.urlopen(urllib.request.Request(SAS, headers={'User-Agent': 'geo-campaign-2026 proposal-dc'}), timeout=30))['token']
    for b in ('ST_B10', 'QA_PIXEL'):
        p = os.path.join(cache, f'ls_{b}.npz')
        if not os.path.exists(p):
            save(cache, f'ls_{b}', Cog(LS_BASE % b + '?' + tok), box)


if __name__ == '__main__':
    main()
