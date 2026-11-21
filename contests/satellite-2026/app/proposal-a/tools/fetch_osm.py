#!/usr/bin/env python3
"""OpenStreetMap の道路（車道）を Overpass API から GET で取得して tools/cache/osm.json に置く。
UA ヘッダ必須（無いと 406）。生データはコミットしない。ODbL（© OpenStreetMap contributors）。
usage: python3 tools/fetch_osm.py [south west north east]
"""
import json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
UA = {'User-Agent': 'geo-campaign-2026 satellite-2026 demo (GET only)'}
HIGHWAYS = 'trunk|primary|secondary|tertiary|unclassified|residential|living_street'


def main():
    bb = sys.argv[1:5] if len(sys.argv) >= 5 else ['34.795', '135.470', '34.825', '135.510']
    q = f'[out:json][timeout:60];way["highway"~"^({HIGHWAYS})$"]({",".join(bb)});out geom;'
    url = 'https://overpass-api.de/api/interpreter?' + urllib.parse.urlencode({'data': q})
    os.makedirs(CACHE, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        data = json.load(r)
    with open(os.path.join(CACHE, 'osm.json'), 'w') as f:
        json.dump(data, f)
    print(len(data.get('elements', [])), 'ways;', data.get('osm3s', {}).get('timestamp_osm_base'))


if __name__ == '__main__':
    main()
