#!/usr/bin/env python3
"""国土地理院「衛星SAR地盤変動測量成果」の地理院タイル（qu=準上下方向）を取得する。GET のみ・認証なし・1 秒間隔。
提案A（proposal-a/tools/fetch_insar.py）と同じ取得。保存先は引数（生のタイルはコミットしない）。
usage: python3 -I tools/fetch_insar.py CACHE_DIR [west south east north]
クレジット: 解析：国土地理院 原初データ所有：JAXA
"""
import math, os, sys, time, urllib.request

BASE = 'https://insarmap.gsi.go.jp/xyz/merge_sbas_regular_japan_20260331_qu_u16/{z}/{x}/{y}.png'
LEGEND = 'https://insarmap.gsi.go.jp/image/cyberjapan/tsa_bcyr2_qu_-3_3cm.png'
UA = {'User-Agent': 'geo-campaign-2026 satellite-2026 proposal-dc (GET only)'}
Z = 15
DEFAULT_BBOX = (130.63, 33.69, 130.91, 33.93)  # 直方・鞍手・北九州市西部


def tile_xy(lon, lat, z=Z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def get(url, path):
    if os.path.exists(path):
        return
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    time.sleep(1.0)


def main():
    cache = sys.argv[1]
    bb = tuple(map(float, sys.argv[2:6])) if len(sys.argv) >= 6 else DEFAULT_BBOX
    w, s, e, n = bb
    os.makedirs(cache, exist_ok=True)
    get(LEGEND, os.path.join(cache, 'legend_qu.png'))
    x0, y1 = map(math.floor, tile_xy(w, s))
    x1, y0 = map(math.floor, tile_xy(e, n))
    ok = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            try:
                get(BASE.format(z=Z, x=x, y=y), os.path.join(cache, f'qu_{Z}_{x}_{y}.png'))
                ok += 1
            except Exception as ex:
                print('skip', x, y, ex, file=sys.stderr)
    print(f'{ok} tiles (x {x0}-{x1}, y {y0}-{y1}) -> {cache}')


if __name__ == '__main__':
    main()
