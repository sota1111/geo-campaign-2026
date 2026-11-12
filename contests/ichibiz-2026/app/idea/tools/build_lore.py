#!/usr/bin/env python3
"""国土地理院「自然災害伝承碑」(地理院地図の配信データ)から、対象範囲の点を data/lore.json に切り出す。
GETのみ。出典: 国土地理院 自然災害伝承碑 (https://maps.gsi.go.jp/xyz/disaster_lore_all/7/{x}/{y}.geojson)
写真(Image)は広島市分で「二次利用に利用申請が必要」とされるため、取り込まない。
usage: python3 tools/build_lore.py
"""
import json, math, re, urllib.request, pathlib

BBOX = (132.40, 34.40, 132.56, 34.55)  # lon_min, lat_min, lon_max, lat_max (広島市安佐南区とその周辺)
Z = 7


def tile(lat, lon, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def clean(s):
    return re.sub(r'\s+', ' ', re.sub(r'<br\s*/?>', ' / ', s or '')).strip()


def main():
    tiles = {tile(BBOX[1], BBOX[0], Z), tile(BBOX[3], BBOX[2], Z), tile(BBOX[1], BBOX[2], Z), tile(BBOX[3], BBOX[0], Z)}
    feats = {}
    for x, y in sorted(tiles):
        url = f'https://maps.gsi.go.jp/xyz/disaster_lore_all/{Z}/{x}/{y}.geojson'
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.load(r)
        for f in d['features']:
            lon, lat = f['geometry']['coordinates'][:2]
            if BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]:
                p = f['properties']
                feats[p['ID']] = {
                    'id': p['ID'], 'name': clean(p['LoreName']), 'year': clean(p['LoreYear']),
                    'address': clean(p['Address']), 'disaster': clean(p['DisasterName']),
                    'kind': clean(p['DisasterKind']), 'info': clean(p['DisasterInfo']),
                    'lon': round(lon, 5), 'lat': round(lat, 5),
                }
    out = {'source': '国土地理院 自然災害伝承碑', 'bbox': BBOX, 'items': sorted(feats.values(), key=lambda v: v['id'])}
    path = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'lore.json'
    path.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
    print(len(feats), 'items ->', path)


if __name__ == '__main__':
    main()
