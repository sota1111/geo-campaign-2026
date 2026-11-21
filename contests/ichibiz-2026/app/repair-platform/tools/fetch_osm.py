#!/usr/bin/env python3
"""OpenStreetMap（Overpass API）から墨田区の共同住宅らしい建物を GET で取り、PLATEAU の建物と位置で突き合わせる。
使い方: python3 -I tools/fetch_osm.py <出力JSON> [取得済みOverpass応答JSON]
データ: © OpenStreetMap contributors, ODbL 1.0。名前は OSM の name タグにあるものだけ。作らない。"""
import json, sys, urllib.request, urllib.parse, os

Q = ('[out:json][timeout:120];area["name"="墨田区"]["boundary"="administrative"]->.a;'
     '(way["building"~"^(apartments|residential|dormitory)$"](area.a););out center tags;')


def fetch():
    url = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(Q)
    req = urllib.request.Request(url, headers={'User-Agent': 'geo-campaign-2026-research/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def pip(x, y, ring):
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins


def main():
    out = sys.argv[1]
    osm = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else fetch()
    here = os.path.dirname(os.path.abspath(__file__))
    bd = json.load(open(os.path.join(here, '..', 'web', 'data', 'buildings.json')))['buildings']
    grid = {}
    for b in bd:
        grid.setdefault((round(b['lon'], 3), round(b['lat'], 3)), []).append(b)
    items = []
    for e in osm['elements']:
        c = e.get('center')
        t = e.get('tags', {})
        if not c:
            continue
        x, y = c['lon'], c['lat']
        cands = []
        for dx in (-0.001, 0, 0.001):
            for dy in (-0.001, 0, 0.001):
                cands += grid.get((round(x + dx, 3), round(y + dy, 3)), [])
        hit = None
        for b in cands:
            if pip(x, y, b['ring']):
                hit = b
                break
        if not hit:
            continue  # 地図の候補（高さ12m以上・屋根150㎡以上）に入らない建物は対象外
        items.append({'osm': e['id'], 'id': hit['id'], 'name': t.get('name'), 'btype': t['building'],
                      'wiki': t.get('wikimedia_commons'), 'image': t.get('image')})
    best = {}
    for it in items:
        k = it['id']
        if k not in best or (it['name'] and not best[k]['name']):
            best[k] = it
    res = list(best.values())
    named = sum(1 for r in res if r['name'])
    json.dump({'meta': {'source': 'OpenStreetMap contributors（Overpass API の GET）', 'license': 'ODbL 1.0',
                        'osmWays': len(osm['elements']), 'matched': len(res), 'named': named}, 'items': res},
              open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(osm, open(out + '.raw', 'w'), ensure_ascii=False)
    print('osm ways', len(osm['elements']), 'matched', len(res), 'named', named)


main()
