#!/usr/bin/env python3
"""全国版（市町村単位）の成果物を作る。入力は各 national_*.py の出力。
  <作業>/agg/*.json    スギ人工林の500mメッシュ集計（national_mesh.py）
  <作業>/n03/<県>/     行政区域 N03（national_fetch_gis.py）
  <作業>/pop1km.json   人口1kmメッシュ（national_pop.py）
  <作業>/wc_tree.json  ESA WorldCover の樹木被覆（national_worldcover.py。無ければ衛星の列は空）
  tools/jouyo_r6.json, tools/census2020_private.json（national_jouyo.py）
出力: data/nat.js（市町村の表と、1kmの格子ごとのスギ人工林。window.SUGI_NAT）、data/nat_geo.js（簡略化した市町村境界。window.SUGI_NAT_GEO）
単位（ユニット）= 市町村。政令指定都市は区をまとめて市1つ、東京23区は区ごと（譲与額の表に合わせる）。
市町村への割り当ては「格子の中心点がその市町村の境界に入るか」。海岸で外れた格子は 1km 以内の最寄りの市町村に入れる。
使い方: python3 -I tools/national_build.py <作業ディレクトリ>   （shapely 2.x・fiona・numpy が必要）
"""
import base64, collections, glob, json, math, os, sys

import fiona
import numpy as np
import shapely
from shapely.geometry import mapping, shape
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NORTH_ISLAND_GUN = {'国後郡', '択捉郡', '紗那郡', '蘂取郡', '色丹郡'}  # 北方領土（人口・譲与額・森林簿なし）
SIMPLIFY = 0.003   # 度（約300m）
CELL_HA = 0.04     # 20m メッシュ1個 = 0.04 ha


def norm(s):
    return ''.join(s.split()).replace('ヶ', 'ケ').replace('ヵ', 'ケ')


def load_units(work):
    """N03 を市町村ユニットにまとめる。戻り値 {code: {pref, name, geoms}}"""
    units = {}
    for shp in sorted(glob.glob(os.path.join(work, 'n03', '*', '*.shp'))):
        with fiona.open(shp) as s:
            for f in s:
                p = f['properties']
                code, name = p['N03_007'], p['N03_004']
                if not code or not name or name == '所属未定地' or p['N03_003'] in NORTH_ISLAND_GUN:
                    continue
                if p['N03_005'] and name.endswith('市'):   # 政令指定都市の区 → 市にまとめる
                    code = code[:3] + '00'
                u = units.setdefault(code, {'pref': p['N03_001'], 'name': name, 'geoms': []})
                u['geoms'].append(shape(f['geometry']))
    return units


class Locator:
    def __init__(self, geoms):
        self.geoms = geoms
        self.tree = STRtree(geoms)

    def locate(self, lon, lat, near_deg=0.01):
        """点（配列）→ ユニット番号の配列（見つからなければ -1）。境界の内側を先に、外れたものは最寄り（near_deg 以内）。"""
        pts = shapely.points(lon, lat)
        out = np.full(len(pts), -1, dtype=np.int64)
        qi, gi = self.tree.query(pts, predicate='within')
        out[qi] = gi
        miss = np.where(out < 0)[0]
        if len(miss):
            ni = self.tree.nearest(pts[miss])
            d = np.array([shapely.distance(pts[m], self.geoms[n]) for m, n in zip(miss, ni)])
            ok = d <= near_deg
            out[miss[ok]] = ni[ok]
        return out


def b64(a):
    return base64.b64encode(np.asarray(a, dtype='<u2').tobytes()).decode('ascii')


def main(work):
    units = load_units(work)
    codes = sorted(units)
    print('市町村ユニット', len(codes), flush=True)
    full = [shapely.unary_union(units[c]['geoms']) for c in codes]
    loc = Locator(full)
    idx = {c: i for i, c in enumerate(codes)}
    U = len(codes)

    # --- スギ人工林（500m → 市町村・1km格子）---
    acc = np.zeros(U * 5, dtype=np.int64).reshape(U, 5)     # n, n26, n21, nunk, 割り当て不能でない数
    cells = collections.defaultdict(lambda: [0, 0])          # (u, gy, gx) → [n26, n21]
    vint = collections.Counter(); tot_all = 0; lost = [0, 0]; tiles = 0
    rows = []
    for p in sorted(glob.glob(os.path.join(work, 'agg', '*.json'))):
        d = json.load(open(p)); tiles += 1; tot_all += d['tot']
        for y, c in d['vint'].items():
            vint[y] += c
        rows += d['cells']
    a = np.array(rows, dtype=np.int64)
    key = a[:, 0]
    # 同じ500mが隣り合う図郭で重なって入る場合に備えて合算（重なりの有無は dup として記録）
    uk, inv = np.unique(key, return_inverse=True)
    dup = int(len(key) - len(uk))
    agg = np.zeros((len(uk), 4), dtype=np.int64)
    for j in range(4):
        agg[:, j] = np.bincount(inv, weights=a[:, 1 + j], minlength=len(uk)).astype(np.int64)
    iy, ix = uk // 100000, uk % 100000
    lat = (iy + 0.5) / 240.0; lon = (ix + 0.5) / 160.0
    ui = loc.locate(lon, lat)
    lost = [int((ui < 0).sum()), int(agg[ui < 0, 0].sum())]
    for k in range(len(uk)):
        u = ui[k]
        if u < 0:
            continue
        acc[u, 0] += agg[k, 0]; acc[u, 1] += agg[k, 1]; acc[u, 2] += agg[k, 2]; acc[u, 3] += agg[k, 3]
        if agg[k, 1] > 0 or agg[k, 2] > 0:
            c = cells[(int(u), int(iy[k] // 2), int(ix[k] // 2))]
            c[0] += int(agg[k, 1]); c[1] += int(agg[k, 2])
    print('500m 格子', len(uk), '重なり', dup, '割り当て不能', lost, 'スギ20m総数', int(agg[:, 0].sum()), flush=True)

    # --- 人口（1kmメッシュ → 市町村。人口の重心）---
    pop = json.load(open(os.path.join(work, 'pop1km.json')))
    pa = np.array(pop)
    pu = loc.locate(pa[:, 1], pa[:, 0])
    popsum = np.zeros(U); plat = np.zeros(U); plon = np.zeros(U)
    ok = pu >= 0
    np.add.at(popsum, pu[ok], pa[ok, 2])
    np.add.at(plat, pu[ok], pa[ok, 2] * pa[ok, 0]); np.add.at(plon, pu[ok], pa[ok, 2] * pa[ok, 1])
    pop_lost = int(pa[~ok, 2].sum())
    print('人口 合計', int(pa[:, 2].sum()), '割り当て不能', pop_lost, flush=True)

    # --- 衛星由来の樹木被覆（ESA WorldCover）---
    tree_ha = np.zeros(U); land_ha = np.zeros(U); wc_meta = None
    wp = os.path.join(work, 'wc_tree.json')
    if os.path.exists(wp):
        w = json.load(open(wp)); wc_meta = {'tiles': w['tiles'], 'level': w['level']}
        wa = np.array(w['cells'], dtype=np.int64)
        wlat = (wa[:, 0] + 0.5) / 120.0; wlon = (wa[:, 1] + 0.5) / 80.0
        wu = loc.locate(wlon, wlat)
        # 標本1個の面積: 概観の画素 = 10m × 2^k（k は level に応じた間引き。2,4,8,16,32,64 の level+1 番目）
        f = [2, 4, 8, 16, 32, 64][w['level']]
        pix_deg = f / 12000.0
        sample_ha = (pix_deg * 111.32) * (pix_deg * 111.32 * np.cos(np.radians(wlat))) * 100.0
        okw = wu >= 0
        np.add.at(tree_ha, wu[okw], wa[okw, 3] * sample_ha[okw])
        np.add.at(land_ha, wu[okw], wa[okw, 2] * sample_ha[okw])

    # --- 譲与額・センサス ---
    jo = json.load(open(os.path.join(HERE, 'jouyo_r6.json')))['rows']
    jmap = {(r['pref'], norm(r['name'])): r['total'] for r in jo}
    cs = json.load(open(os.path.join(HERE, 'census2020_private.json')))['rows']
    jouyo = np.full(U, -1, dtype=np.int64); priv = np.full(U, -1.0)
    unmatched = []
    used = set()
    for c, i in idx.items():
        u = units[c]
        k = (u['pref'], norm(u['name']))
        if k in jmap:
            jouyo[i] = jmap[k]; used.add(k)
        else:
            unmatched.append((c, u['pref'], u['name']))
        if c in cs:
            priv[i] = cs[c]['ha']
    not_used = [k for k in jmap if k not in used]
    print('譲与額: 照合できた', int((jouyo >= 0).sum()), '／ユニット側で照合できず', len(unmatched), unmatched[:12], '／表側で使われず', len(not_used), not_used[:12])
    print('センサス: 照合できた', int((priv >= 0).sum()))

    # --- ユニットの並べ替え（人口と森林簿のどちらも 0 の無意味なユニットは残す。境界は地図に必要）---
    prefs = []
    for c in codes:
        if units[c]['pref'] not in prefs:
            prefs.append(units[c]['pref'])
    lat_c = np.where(popsum > 0, plat / np.maximum(popsum, 1), [g.representative_point().y for g in full])
    lon_c = np.where(popsum > 0, plon / np.maximum(popsum, 1), [g.representative_point().x for g in full])
    area_km2 = []
    for g in full:
        c = g.centroid
        area_km2.append(g.area * (111.32 ** 2) * math.cos(math.radians(c.y)))
    meta = {
        'units': U, 'prefs': prefs, 'cell_ha': CELL_HA, 'mesh_tiles': tiles, 'mesh_cells20_total': int(tot_all),
        'mesh_vintage': {k: v for k, v in sorted(vint.items(), key=lambda kv: -kv[1])[:8]},
        'sugi_ha': round(float(acc[:, 0].sum() * CELL_HA)), 'sugi26_ha': round(float(acc[:, 1].sum() * CELL_HA)),
        'lost_ha': round(lost[1] * CELL_HA), 'pop_total': int(popsum.sum()), 'pop_lost': pop_lost, 'dup500': dup,
        'jouyo_matched': int((jouyo >= 0).sum()), 'jouyo_rows': len(jo), 'jouyo_total_k': int(sum(r['total'] for r in jo)),
        'jouyo_unmatched_units': [list(x) for x in unmatched], 'wc': wc_meta,
        'n_cells': len(cells),
    }
    nat = {
        'meta': meta,
        'u': {
            'code': codes,
            'name': [units[c]['name'] for c in codes],
            'pref': [prefs.index(units[c]['pref']) for c in codes],
            'pop': [int(round(x / 10) * 10) for x in popsum],
            'lat': [round(float(x), 4) for x in lat_c], 'lon': [round(float(x), 4) for x in lon_c],
            'ha': [round(float(x * CELL_HA), 1) for x in acc[:, 0]],
            'ha26': [round(float(x * CELL_HA), 1) for x in acc[:, 1]],
            'ha21': [round(float(x * CELL_HA), 1) for x in acc[:, 2]],
            'tree': [round(float(x)) for x in tree_ha], 'land': [round(float(x)) for x in land_ha],
            'area': [round(float(x), 1) for x in area_km2],
            'jouyo': [int(x) for x in jouyo], 'priv': [round(float(x)) for x in priv],
        },
    }
    ks = sorted(cells)
    nat['cells'] = {
        'n': len(ks),
        'u': b64([k[0] for k in ks]), 'gy': b64([k[1] for k in ks]), 'gx': b64([k[2] for k in ks]),
        'n26': b64([min(cells[k][0], 65535) for k in ks]), 'n21': b64([min(cells[k][1], 65535) for k in ks]),
    }
    open(os.path.join(ROOT, 'data', 'nat.js'), 'w', encoding='utf-8').write('window.SUGI_NAT = ' + json.dumps(nat, ensure_ascii=False, separators=(',', ':')) + ';\n')

    # --- 簡略化した境界 ---
    feats = []
    for i, g in enumerate(full):
        s = shapely.simplify(g, SIMPLIFY, preserve_topology=True)
        polys = [s] if s.geom_type == 'Polygon' else list(s.geoms)
        polys = [q for q in polys if q.area > 2e-5] or [max(polys, key=lambda q: q.area)]   # 約2km2未満の島は落とす（全部小さければ最大の1つを残す）
        geom = shapely.MultiPolygon(polys) if len(polys) > 1 else polys[0]
        m = mapping(geom)
        m = json.loads(json.dumps(m))

        def rnd(c):
            return [round(c[0], 3), round(c[1], 3)] if not isinstance(c[0], list) else [rnd(x) for x in c]
        m['coordinates'] = rnd(m['coordinates'])
        feats.append({'type': 'Feature', 'id': i, 'properties': {}, 'geometry': m})
    gj = {'type': 'FeatureCollection', 'features': feats}
    open(os.path.join(ROOT, 'data', 'nat_geo.js'), 'w', encoding='utf-8').write('window.SUGI_NAT_GEO = ' + json.dumps(gj, separators=(',', ':')) + ';\n')
    print('nat.js', os.path.getsize(os.path.join(ROOT, 'data', 'nat.js')), 'bytes; nat_geo.js', os.path.getsize(os.path.join(ROOT, 'data', 'nat_geo.js')), 'bytes')
    print(json.dumps(meta, ensure_ascii=False)[:1500])


if __name__ == '__main__':
    main(sys.argv[1])
