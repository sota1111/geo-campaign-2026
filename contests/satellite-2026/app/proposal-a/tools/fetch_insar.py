#!/usr/bin/env python3
"""国土地理院「衛星SAR地盤変動測量成果」の地理院タイル（qu=準上下方向の変位速度）を取得して tools/cache/ に置く。
GET のみ・認証なし・1 秒間隔。生のタイルはコミットしない（.gitignore）。
usage: python3 tools/fetch_insar.py [qu|dr|ar] [west south east north]
クレジット: 解析：国土地理院 原初データ所有：JAXA
"""
import math, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
BASE = 'https://insarmap.gsi.go.jp/xyz/merge_sbas_regular_japan_20260331_{layer}_u16/{z}/{x}/{y}.png'
LEGEND = 'https://insarmap.gsi.go.jp/image/cyberjapan/tsa_bcyr2_qu_-3_3cm.png'
UA = {'User-Agent': 'geo-campaign-2026 satellite-2026 demo (GET only)'}
Z = 15  # 配信の最大ネイティブズーム


def tile_xy(lon, lat, z=Z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def get(url, path):
    if os.path.exists(path):
        return
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    time.sleep(1.0)


def main():
    args = sys.argv[1:]
    layer = args.pop(0) if args and args[0] in ('qu', 'dr', 'ar') else 'qu'
    w, s, e, n = (map(float, args) if len(args) == 4 else (135.43, 34.74, 135.51, 34.83))  # 豊中市とその周辺
    os.makedirs(CACHE, exist_ok=True)
    get(LEGEND, os.path.join(CACHE, 'legend_qu.png'))
    x0, y1 = map(math.floor, tile_xy(w, s))
    x1, y0 = map(math.floor, tile_xy(e, n))
    cnt = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            p = os.path.join(CACHE, f'{layer}_{Z}_{x}_{y}.png')
            try:
                get(BASE.format(layer=layer, z=Z, x=x, y=y), p)
                cnt += 1
            except Exception as ex:
                print('skip', x, y, ex, file=sys.stderr)
    print(f'{cnt} tiles (x {x0}-{x1}, y {y0}-{y1}) -> {CACHE}')


if __name__ == '__main__':
    main()
