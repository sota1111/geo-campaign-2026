#!/usr/bin/env python3
"""関東1都6県の区分用データ data/kanto.js を作る。
入力（第1引数 RAW）:
  RAW/agg.json        tools/kanto_aggregate.py の出力（500mメッシュのスギ人工林の集計）
  RAW/n03/<都県コード>/N03-20250101_<コード>.shp   国土数値情報 行政区域2025年版（CC BY 4.0）。都県コード 08〜14
  tools/kanto_zone.json      林野庁「スギ人工林伐採重点区域の設定について」（令和8年4月1日時点）の市町村（tools/kanto_zone.py で作成）
  tools/kanto_origins.json   50km圏の起点（tools/kanto_origins.py で作成）
出力: data/kanto.js（window.SUGI_KANTO）。
処理: 500mメッシュの中心点が属する市区町村（N03）、起点（県庁所在地・政令市・中核市・施行時特例市の点、東京都区部は23区の合併領域）までの最短距離（km）、
      50km圏の外縁、市町村境界（単純化）。スギ人工林が MIN_HA 未満のメッシュは載せない。
使い方: python3 -I tools/kanto_build.py RAW
"""
import glob, json, math, os, sys

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data', 'kanto.js')
MIN_HA = 1.0           # 500mメッシュ内のスギ人工林がこれ未満なら載せない（ごく小さい破片）。20mメッシュ25個 = 1 ha
RADIUS_KM = 50         # 推進方針の目安（県庁所在地・政令市・中核市・施行時特例市・東京都区部から50km圏）
PREFS = {'08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県'}
TO_XY = Transformer.from_crs(4326, 6677, always_xy=True)
TO_LL = Transformer.from_crs(6677, 4326, always_xy=True)


def norm(s):
    return s.replace('ヶ', 'ケ').replace('ｹ', 'ケ')


def load_n03(raw):
    import fiona
    rows = []
    for code, pref in PREFS.items():
        for shp in glob.glob(os.path.join(raw, 'n03', code, '*.shp')):
            with fiona.open(shp) as s:
                for f in s:
                    p = f['properties']
                    if not p.get('N03_004'):
                        continue  # 所属未定地など
                    rows.append((pref, p['N03_004'], shape(f['geometry'])))
    return rows


def rounded(geom, nd=4):
    def ring(r):
        return [[round(x, nd), round(y, nd)] for x, y in r.coords]
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms)
    out = []
    for g in polys:
        if g.is_empty or not isinstance(g, Polygon):
            continue
        out.append([ring(g.exterior)] + [ring(i) for i in g.interiors])
    return out


def main(raw):
    agg = json.load(open(os.path.join(raw, 'agg.json')))
    zone = json.load(open(os.path.join(HERE, 'kanto_zone.json')))
    zone_set = {(p, norm(n)) for p, v in zone['munis'].items() for n in v}
    origins = json.load(open(os.path.join(HERE, 'kanto_origins.json')))

    rows = load_n03(raw)
    print('n03 polygons', len(rows), flush=True)
    # 市区町村ごとに合併（政令市の区は N03_004 が市名なので市単位、東京都区部は区単位）
    by = {}
    for pref, name, g in rows:
        by.setdefault((pref, name), []).append(g)
    keys = sorted(by)
    merged = [shapely.make_valid(unary_union([shapely.make_valid(g) for g in by[k]])) for k in keys]
    tree = STRtree(merged)

    # 区部（東京都23区）の合併領域
    ku = [m for k, m in zip(keys, merged) if k[0] == '東京都' and k[1].endswith('区')]
    ku_union = unary_union(ku)
    ku_xy = transform(TO_XY.transform, ku_union)

    cells = agg['cells']  # [iy, ix, n, n26, n21, nunk, slope_sum, slope_n]
    cells = [c for c in cells if c[2] * 0.04 >= MIN_HA]
    iy = np.array([c[0] for c in cells]); ix = np.array([c[1] for c in cells])
    lat = (iy + 0.5) / 240.0; lon = (ix + 0.5) / 160.0
    pts = shapely.points(lon, lat)
    pi, gi = tree.query(pts, predicate='within')
    muni = np.full(len(cells), -1)
    muni[pi] = gi
    keep = muni >= 0
    print('cells', len(cells), 'in-kanto', int(keep.sum()), flush=True)

    # 距離（km）。起点の点は 6677 の平面で計算
    x, y = TO_XY.transform(lon, lat)
    org_pts = [(o['name'], o['lon'], o['lat']) for o in origins]
    ox, oy = TO_XY.transform([o[1] for o in org_pts], [o[2] for o in org_pts])
    dmat = np.sqrt((x[:, None] - np.array(ox)[None, :]) ** 2 + (y[:, None] - np.array(oy)[None, :]) ** 2) / 1000.0
    d_ku = shapely.distance(shapely.points(x, y), ku_xy) / 1000.0
    dall = np.concatenate([dmat, d_ku[:, None]], axis=1)  # 最後の列 = 東京都区部
    near = dall.argmin(axis=1); dmin = dall.min(axis=1)

    sel = np.where(keep)[0]
    mids = sorted(set(muni[sel].tolist()))
    remap = {m: i for i, m in enumerate(mids)}
    munis = []
    for m in mids:
        pref, name = keys[m]
        c = merged[m].representative_point()
        munis.append([name, list(PREFS.values()).index(pref), 1 if (pref, norm(name)) in zone_set else 0, round(c.x, 4), round(c.y, 4)])
    miss = sorted(k for k in zone_set if (k[0], k[1]) not in {(p, norm(n)) for p, n in keys})
    print('重点区域の市町村のうち N03 に見つからない:', miss)

    def col(a, f=lambda v: v):
        return [f(v) for v in a[sel].tolist()]

    nn = np.array([c[2] for c in cells]); n26 = np.array([c[3] for c in cells]); n21 = np.array([c[4] for c in cells]); nunk = np.array([c[5] for c in cells])
    sl = np.array([(c[6] / c[7]) if c[7] else -1 for c in cells])
    # 50km圏の外縁（起点の円と区部の合併を 50km 広げた領域の和）
    buf = [Point(a, b).buffer(RADIUS_KM * 1000, 32) for a, b in zip(ox, oy)] + [ku_xy.buffer(RADIUS_KM * 1000, 32)]
    ring = transform(TO_LL.transform, unary_union(buf)).simplify(0.002)
    # 市町村境界（単純化。関東の外は不要）
    mgeo = []
    for m in mids:
        g = merged[m].simplify(0.003, preserve_topology=True)
        polys = [g] if isinstance(g, Polygon) else [q for q in getattr(g, 'geoms', []) if isinstance(q, Polygon)]
        polys = [q for q in polys if q.area > 4e-5]  # 約 0.4 km2 未満の島などは省く
        if polys:
            mgeo.append([remap[m], rounded(MultiPolygon(polys), 4)])
    cen = transform(TO_LL.transform, ku_xy.representative_point())

    org_out = [[o['name'], o['pref'], '・'.join(o['kinds']), round(o['lon'], 4), round(o['lat'], 4)] for o in origins]
    org_out.append(['東京都区部', '東京都', '特別区の存する区域', round(cen.x, 4), round(cen.y, 4)])
    data = {
        'meta': {
            'built': '2026-11-21', 'radiusKm': RADIUS_KM, 'minHa': MIN_HA, 'cellDef': '500mメッシュ（地域メッシュ4次、15秒×22.5秒）',
            'src': agg['stats'],
            'prefs': list(PREFS.values()),
        },
        'munis': munis,
        'origins': org_out,
        'cells': {
            'iy': col(iy), 'ix': col(ix), 'n': col(nn), 'n26': col(n26), 'n21': col(n21), 'nunk': col(nunk),
            'slope': col(sl, lambda v: -1 if v < 0 else round(v, 1)),
            'dist': col(dmin, lambda v: round(v, 1)), 'org': col(near), 'muni': col(muni, lambda v: remap[v]),
        },
        'zone': {'source': zone['source'], 'asof': zone['asof'], 'areasHa': zone['areas_ha']},
        'verify': json.load(open(os.path.join(HERE, 'kanto_verify.json'), encoding='utf-8')),
        'ring': rounded(ring if not isinstance(ring, Polygon) else MultiPolygon([ring]), 4),
        'muniGeo': mgeo,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// tools/kanto_build.py が生成。林野庁 全国森林資源メッシュ・国土数値情報（行政区域N03・標高傾斜度G04-d）・総務省の都市区分・林野庁の伐採重点区域を加工した実データ。手で編集しない。\n')
        f.write('window.SUGI_KANTO = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote', OUT, os.path.getsize(OUT) / 1e6, 'MB; cells', len(sel), 'munis', len(munis))


if __name__ == '__main__':
    main(sys.argv[1])
