#!/usr/bin/env python3
"""環境省 現存植生図2024（関東ブロック、調査年度 2000-2023）から、対象範囲のスギ・ヒノキ・サワラ植林ポリゴンを取得する（GET のみ）。
出力: 第1引数のディレクトリに veg_raw.json（GeoJSON, EPSG:4326）。
使い方: python3 -I tools/fetch_vegetation.py <出力ディレクトリ>
"""
import json, os, sys, urllib.parse, urllib.request

URL = 'https://svr-moej.gisservice.jp/arcgis/rest/services/Hosted/veg2024bk3/FeatureServer/0/query'
BBOX = (139.17, 35.76, 139.35, 35.88)  # 東京都 青梅市を中心に、日の出町・あきる野市・瑞穂町・羽村市・奥多摩町の一部と埼玉県 飯能市・入間市・日高市の一部
WHERE = "凡例名 like '%スギ%'"


def get(params):
    params['f'] = 'geojson'
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(params), timeout=120) as r:
        return json.load(r)


def main(out):
    feats, off = [], 0
    while True:
        d = get({'where': WHERE, 'outFields': 'fid,凡例コード,凡例名,植生自然度,作成年度', 'geometry': ','.join(map(str, BBOX)),
                 'geometryType': 'esriGeometryEnvelope', 'inSR': '4326', 'spatialRel': 'esriSpatialRelIntersects',
                 'outSR': '4326', 'resultOffset': off, 'resultRecordCount': 1000, 'orderByFields': 'fid'})
        fs = d.get('features', [])
        feats += fs
        if len(fs) < 1000:
            break
        off += len(fs)
    os.makedirs(out, exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(out, 'veg_raw.json'), 'w'), ensure_ascii=False)
    print(len(feats), 'features')


if __name__ == '__main__':
    main(sys.argv[1])
