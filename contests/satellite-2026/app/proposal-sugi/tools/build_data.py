#!/usr/bin/env python3
"""取得・計算済みの素材から、画面が読む data/data.js（window.SUGI）を作る。
入力: <素材ディレクトリ>/ veg_raw.json, pop_cells.json, wind.json, ndvi.json
出力: data/data.js
使い方: PYTHONPATH=<依存の入った場所> python3 tools/build_data.py <素材ディレクトリ>
"""
import datetime
import json
import os
import sys

from shapely.geometry import mapping

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cells as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西']


def round_coords(o, nd=5):
    if isinstance(o, (list, tuple)):
        return [round_coords(x, nd) for x in o] if o and isinstance(o[0], (list, tuple)) else [round(x, nd) for x in o]
    return o


def main(raw):
    sugi = C.load_sugi(os.path.join(raw, 'veg_raw.json'))
    cells = C.build_cells(sugi)
    pop = json.load(open(os.path.join(raw, 'pop_cells.json')))
    wind = json.load(open(os.path.join(raw, 'wind.json')))
    nd = json.load(open(os.path.join(raw, 'ndvi.json')))
    codes = sorted(cells)
    rows, feats = [], []
    for k in codes:
        c = cells[k]
        n = nd['cells'][k]
        rows.append([k, round(c['ha'], 2), n.get('w'), n.get('s'), round(c['center'][0], 5), round(c['center'][1], 5)])
        g = c['geom_ll'].simplify(0.00006, preserve_topology=True)
        if g.is_empty:
            continue
        m = mapping(g)
        feats.append({'type': 'Feature', 'id': k, 'properties': {'code': k},
                      'geometry': {'type': m['type'], 'coordinates': round_coords(m['coordinates'])}})
    total = sum(wind['counts'].values())
    data = {
        'meta': {
            'area': '東京都 青梅市を中心に、日の出町・あきる野市・瑞穂町・羽村市・奥多摩町の一部と埼玉県 飯能市・入間市・日高市の一部', 'bbox': list(C.BBOX), 'built': datetime.date.today().isoformat(),
            'cellDef': '500mメッシュ（地域メッシュ 4次メッシュ）のうちスギ・ヒノキ・サワラ植林を含むもの',
            'scenes': nd['scenes'],
            'wind': {'station': 'アメダス青梅', 'years': wind['years'], 'months': wind['months'], 'days': total,
                     'dirs': DIRS, 'freq': [round(wind['counts'][d] / total, 4) for d in DIRS]},
            'popHidden': pop['hidden'],
        },
        'cols': ['code', 'ha', 'ndviWinter', 'ndviSummer', 'lat', 'lon'],
        'cells': rows,
        'pop': pop['cells'],
        'geo': {'type': 'FeatureCollection', 'features': feats},
    }
    out = os.path.join(HERE, '..', 'data', 'data.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('// tools/build_data.py が生成。環境省 植生図・e-Stat 国勢調査メッシュ・気象庁・Sentinel-2 L2A 由来の実データ。手で編集しない。\n')
        f.write('window.SUGI = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(out, os.path.getsize(out), 'bytes;', len(rows), 'cells')


if __name__ == '__main__':
    main(sys.argv[1])
