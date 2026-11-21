#!/usr/bin/env python3
"""OpenStreetMap の変電所・送電線・建物を Overpass API から GET で取得して CACHE_DIR に置く。
UA ヘッダ必須（無いと 406）。生データはコミットしない。ODbL（© OpenStreetMap contributors）。
usage: python3 -I tools/fetch_osm.py CACHE_DIR
  power.json  : 変電所（power=substation。点・線・面の中心）と送電線（power=line）。範囲は候補地の範囲より外側に広げる（最寄りの距離のため）
  bld_<i>_<j>.json: 建物（building）。範囲を格子に割って取得。裸地と建物の区別のためにだけ使う
混んでいると 502/504/timeout になるので、範囲を小さく割り、失敗したら間隔を空けて別の公開サーバーも試す（すべて GET）。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

UA = {'User-Agent': 'geo-campaign-2026 satellite-2026 proposal-dc (GET only)'}
ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']
POWER_BBOX = (33.60, 130.50, 34.02, 131.02)  # south, west, north, east
POWER_GRID = (3, 3)
BLD_BBOX = (33.69, 130.63, 33.93, 130.91)
BLD_GRID = (4, 4)


def overpass(q, timeout=100):
    last = None
    for k in range(8):
        url = ENDPOINTS[k % len(ENDPOINTS)] + '?' + urllib.parse.urlencode({'data': q})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.load(r)
        except Exception as ex:  # noqa: BLE001
            last = ex
            print('retry', k, ex, file=sys.stderr, flush=True)
            time.sleep(10 * (k + 1))
    raise last


def tiles(bbox, grid):
    s, w, n, e = bbox
    gy, gx = grid
    for i in range(gy):
        for j in range(gx):
            yield i, j, f'({s + (n - s) * i / gy:.5f},{w + (e - w) * j / gx:.5f},{s + (n - s) * (i + 1) / gy:.5f},{w + (e - w) * (j + 1) / gx:.5f})'


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    p = os.path.join(cache, 'power.json')
    if not os.path.exists(p):
        subs, lines, ts = {}, {}, ''
        for i, j, b in tiles(POWER_BBOX, POWER_GRID):
            d = overpass(f'[out:json][timeout:60];nwr["power"="substation"]{b};out center tags;')
            ts = d.get('osm3s', {}).get('timestamp_osm_base', ts)
            for el in d['elements']:
                subs[(el['type'], el['id'])] = el
            time.sleep(3)
            d = overpass(f'[out:json][timeout:60];way["power"="line"]{b};out geom tags;')
            for el in d['elements']:
                lines[el['id']] = el
            print('power tile', i, j, len(subs), len(lines), flush=True)
            time.sleep(3)
        with open(p, 'w') as f:
            json.dump({'substations': {'elements': list(subs.values()), 'osm3s': {'timestamp_osm_base': ts}}, 'lines': {'elements': list(lines.values())}}, f)
    for i, j, b in tiles(BLD_BBOX, BLD_GRID):
        pp = os.path.join(cache, f'bld_{i}_{j}.json')
        if os.path.exists(pp):
            continue
        d = overpass(f'[out:json][timeout:90];way["building"]{b};out geom;', timeout=150)
        with open(pp, 'w') as f:
            json.dump(d, f)
        print('bld', i, j, len(d['elements']), flush=True)
        time.sleep(3)


if __name__ == '__main__':
    main()
