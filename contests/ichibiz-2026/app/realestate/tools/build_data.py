#!/usr/bin/env python3
"""web/data/tokushima.json を作る（再現用。実行は任意。生成物はリポジトリに含む）。

入力:
  --a29  国土数値情報 用途地域 A29-19_36 の GeoJSON（徳島市 36201）
  --odpt contests/odpt-2026/app/web/data/tokushima.json（公共交通オープンデータ由来の停留所・駅）
出力: web/data/tokushima.json
APIキーは使わない。ネットワークにも接続しない（ダウンロードは手作業）。
"""
import argparse
import json
import pathlib

ap = argparse.ArgumentParser()
ap.add_argument('--a29', required=True)
ap.add_argument('--odpt', required=True)
ap.add_argument('--out', default=str(pathlib.Path(__file__).resolve().parent.parent / 'web/data/tokushima.json'))
a = ap.parse_args()


def r5(c):
    return [round(c[0], 5), round(c[1], 5)]


zones = []
for f in json.load(open(a.a29, encoding='utf-8'))['features']:
    p, g = f['properties'], f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    out = []
    for poly in polys:
        rings = [[r5(c) for c in ring] for ring in poly]
        out.append(rings)
    zones.append({'name': p['A29_005'], 'bcr': p['A29_006'], 'far': p['A29_007'], 'polys': out})

o = json.load(open(a.odpt, encoding='utf-8'))
bus = [[round(n[0], 5), round(n[1], 5), n[2]] for n in o['nodes']]
rail = [[round(n[0], 5), round(n[1], 5), n[2], n[3]] for n in o['rail']]

data = {
    'municipality': '徳島市',
    'code': '36201',
    'center': [134.5548, 34.0703],
    'bbox': [134.42, 33.98, 134.66, 34.16],
    'zones': zones,
    'bus': bus,
    'rail': rail,
    'zones_source': '国土数値情報 用途地域データ（A29-19 令和元年度版・徳島県）',
    'transit_source': 'GTFSデータリポジトリ掲載の徳島市周辺6事業者のGTFS（CC BY 4.0）。公共交通オープンデータチャレンジ用に加工した停留所位置',
}
pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
json.dump(data, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(a.out, pathlib.Path(a.out).stat().st_size, 'bytes', len(zones), 'zones', len(bus), 'bus', len(rail), 'rail')
