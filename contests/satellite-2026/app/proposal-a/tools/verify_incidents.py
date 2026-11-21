#!/usr/bin/env python3
"""実データでできる検証を計算し、JSON で出す（標準出力）。位置単位ではなく「町」単位。

入力（すべて取得済みの公開データ。python3 -I で読む）:
  --mlit02   国交省「道路陥没発生箇所の詳細」令和6年度 02.xlsx
  --sewer    豊中市 下水道 管渠（BODIK、シェープの .shp。.dbf が同じ場所に必要）
  --chome    e-Stat 令和2年国勢調査 小地域（町丁・字等）境界シェープ（豊中市）の .shp（.dbf 同じ場所）
出力: 豊中市の陥没（令和6年度）の町別件数と、町ごとの下水道管の竣工年（長さ加重の中央値）の比較。
因果・精度は言わない。個別の路線名・番地は出力しない（町名までの件数のみ）。
usage: python3 -I tools/verify_incidents.py --mlit02 A.xlsx --sewer B.shp --chome C.shp > data/verify.json
"""
import argparse
import collections
import json
import math
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shp  # noqa: E402
import xlsx_read  # noqa: E402
from pyproj import Transformer  # noqa: E402

SEED = 20261121
CHOME_RE = re.compile(r'[一二三四五六七八九十]+丁目$')
KANA_TAIL = re.compile(r'[ァ-ヶー・]{3,}$')


def clean(s):
    return KANA_TAIL.sub('', (s or '').replace('\n', '').strip())


def pip(x, y, rings):
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def load_incidents(path):
    d = xlsx_read.read(path)
    out = {}
    for name, rows in d.items():
        if '直轄' in name:
            kind, adm, key, cause = 'national', 'A', 'C', 'D'
        elif '都道府県' in name:
            kind, adm, key, cause = 'prefecture', 'B', 'D', 'E'
        elif '市町村' in name:
            kind, adm, key, cause = 'municipal', 'A', 'C', 'D'
        else:
            continue
        recs = []
        for r in rows:
            addr = clean(r.get(key))
            if not addr or addr == '地名':
                continue
            recs.append({'admin': clean(r.get(adm)), 'addr': addr, 'cause': clean(r.get(cause))})
        out[kind] = recs
    return out


def town_of_incident(addr):
    m = re.match(r'大阪府豊中市(.+?)地先$', addr)
    return m.group(1) if m else None


def auc(pos, neg):
    """pos の score が neg より高い確率（同点は 0.5）。"""
    if not pos or not neg:
        return None
    s = 0.0
    for p in pos:
        for n in neg:
            s += 1.0 if p > n else (0.5 if p == n else 0.0)
    return s / (len(pos) * len(neg))


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else None


def wmedian(pairs):
    """[(値, 重み)] の重み付き中央値。"""
    pairs = sorted(pairs)
    tot = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= tot / 2:
            return v
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mlit02', required=True)
    ap.add_argument('--sewer', required=True)
    ap.add_argument('--chome', required=True)
    ap.add_argument('--tokujuten', help='国交省 全国特別重点調査 別紙2 の xlsx（任意）')
    ap.add_argument('--min-km', type=float, default=1.0, help='比較に入れる町の、竣工年が分かる管の最小延長(km)')
    a = ap.parse_args()

    inc = load_incidents(a.mlit02)
    national = {}
    for kind, recs in inc.items():
        c = collections.Counter(r['cause'] for r in recs)
        national[kind] = {'total': len(recs), 'sewer': c.get('下水道', 0), 'causes': dict(c.most_common())}
    osaka = [r for r in inc['municipal'] if r['addr'].startswith('大阪府')]
    osaka_pref = [r for r in inc['prefecture'] if r['addr'].startswith('大阪府')]
    toy = [r for r in inc['municipal'] if r['admin'] == '豊中市']
    osaka_total = len(osaka) + len(osaka_pref)
    osaka_sewer = sum(1 for r in osaka + osaka_pref if r['cause'] == '下水道')

    DESIGNATED = ['札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '川崎市', '相模原市', '新潟市', '静岡市', '浜松市', '名古屋市',
                  '京都市', '大阪市', '堺市', '神戸市', '岡山市', '広島市', '北九州市', '福岡市', '熊本市']

    def klass(adm):
        if adm in DESIGNATED:
            return 'designated'
        if adm.endswith('区') and not adm.endswith('市'):
            return 'tokubetsu'
        return 'other_municipal'
    by_class = {}
    for r in inc['municipal']:
        k = klass(r['admin'])
        c = by_class.setdefault(k, {'total': 0, 'sewer': 0})
        c['total'] += 1
        c['sewer'] += 1 if r['cause'] == '下水道' else 0
    national['municipal_by_class'] = by_class

    # 町ポリゴン
    dbf = [r for d, r in shp.read_dbf(a.chome.replace('.shp', '.dbf'), encoding='cp932')]
    polys = []
    for row, g in zip(dbf, shp.read_polygons(a.chome)):
        if not g or row.get('CITY_NAME') != '豊中市' or not row.get('S_NAME'):
            continue
        xs = [p[0] for ring in g for p in ring]
        ys = [p[1] for ring in g for p in ring]
        area = float(row.get('AREA') or 0) or 1e18
        polys.append((CHOME_RE.sub('', row['S_NAME']), area, (min(xs), min(ys), max(xs), max(ys)), g))
    polys.sort(key=lambda p: p[1])  # 小さい面積を先に当てる
    town_names = sorted({p[0] for p in polys})

    def locate(lon, lat):
        for name, _, (x0, y0, x1, y1), g in polys:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and pip(lon, lat, g):
                return name
        return None

    # 下水道管（EPSG:6674）。管の中点でどの町か決め、長さは頂点列の長さ。
    to_ll = Transformer.from_crs('EPSG:6674', 'EPSG:4326', always_xy=True)
    recs = shp.read_dbf(a.sewer.replace('.shp', '.dbf'))
    geoms = shp.read_polylines(a.sewer)
    per = collections.defaultdict(lambda: {'known': [], 'unknown_m': 0.0})
    outside_m = 0.0
    total_m = 0.0
    n_pipes = 0
    for (deleted, row), g in zip(recs, geoms):
        if deleted or not g:
            continue
        pts = g[0]
        L = sum(math.hypot(q[0] - p[0], q[1] - p[1]) for part in g for p, q in zip(part, part[1:]))
        if L <= 0:
            continue
        n_pipes += 1
        total_m += L
        mid = pts[len(pts) // 2]
        lon, lat = to_ll.transform(mid[0], mid[1])
        t = locate(lon, lat)
        if t is None:
            outside_m += L
            continue
        yr = row['SYUNKOU_BI'][:4]
        yr = int(yr) if yr.isdigit() else 9999
        if yr >= 9999 or yr < 1900:
            per[t]['unknown_m'] += L
        else:
            per[t]['known'].append((yr, L))

    # 陥没の町別件数
    by_town = collections.defaultdict(lambda: {'all': 0, 'sewer': 0})
    unmatched = collections.Counter()
    for r in toy:
        t = town_of_incident(r['addr'])
        if t is None or t not in town_names:
            unmatched[t or r['addr']] += 1
            continue
        by_town[t]['all'] += 1
        if r['cause'] == '下水道':
            by_town[t]['sewer'] += 1

    towns = []
    for t in town_names:
        k = per[t]['known']
        km = sum(w for _, w in k) / 1000.0
        med = wmedian(k) if k else None
        towns.append({'town': t, 'pipe_km_known': round(km, 2), 'median_year': med,
                      'incidents': by_town[t]['all'], 'sewer_incidents': by_town[t]['sewer']})

    use = [t for t in towns if t['median_year'] is not None and t['pipe_km_known'] >= a.min_km]
    age = [-t['median_year'] for t in use]  # 大きいほど古い
    rate = [t['sewer_incidents'] / t['pipe_km_known'] for t in use]
    rho = spearman(age, rate)
    pos = [-t['median_year'] for t in use if t['sewer_incidents'] > 0]
    neg = [-t['median_year'] for t in use if t['sewer_incidents'] == 0]
    A = auc(pos, neg)
    # 並べ替え検定（件数を町に無作為に割り当て直す。町の管の延長は固定）
    rng = random.Random(SEED)
    inc_pool = []
    for i, t in enumerate(use):
        inc_pool += [i] * t['sewer_incidents']
    ge_rho = ge_auc = 0
    N = 5000
    for _ in range(N):
        # 管延長に比例して件数を再配置（延長だけで説明される帰無仮説）
        w = [t['pipe_km_known'] for t in use]
        pick = rng.choices(range(len(use)), weights=w, k=len(inc_pool))
        cnt = collections.Counter(pick)
        r2 = [cnt.get(i, 0) / use[i]['pipe_km_known'] for i in range(len(use))]
        rho2 = spearman(age, r2)
        if rho2 is not None and rho is not None and rho2 >= rho:
            ge_rho += 1
        p2 = [age[i] for i in range(len(use)) if cnt.get(i, 0) > 0]
        n2 = [age[i] for i in range(len(use)) if cnt.get(i, 0) == 0]
        a2 = auc(p2, n2)
        if a2 is not None and A is not None and a2 >= A:
            ge_auc += 1

    # 町を竣工年の中央値で3群に分ける（古い順）
    ordered = sorted(use, key=lambda t: t['median_year'])
    n3 = len(ordered)
    cuts = [0, n3 // 3, 2 * n3 // 3 + (1 if n3 % 3 == 2 else 0), n3]
    terciles = []
    for name, lo, hi in zip(['oldest', 'middle', 'newest'], cuts, cuts[1:]):
        g = ordered[lo:hi]
        km = sum(t['pipe_km_known'] for t in g)
        si = sum(t['sewer_incidents'] for t in g)
        terciles.append({'group': name, 'towns': len(g), 'year_min': g[0]['median_year'], 'year_max': g[-1]['median_year'],
                         'pipe_km': round(km, 1), 'sewer_incidents': si, 'per_100km': round(si / km * 100, 2)})

    tok = None
    if a.tokujuten:
        tb = xlsx_read.read(a.tokujuten)
        tok = {}
        for sheet, key, cavcol, cavlen in (('優先実施箇所', 'priority', 'N', 'M'), ('優先実施箇所以外', 'other', 'L', 'K')):
            rows = tb[sheet]
            tk = [r for r in rows if clean(r.get('A')) == '大阪府豊中市']
            allcav = sum(float(r[cavcol]) for r in rows if re.match(r'^[0-9.]+$', r.get(cavcol, '')) and re.search(r'[市町村区府県都道]', clean(r.get('A'))))
            if tk:
                r = tk[0]
                tok[key] = {'target_km': round(float(r['B']), 3), 'cavity_survey_km': float(r[cavlen]), 'cavities': float(r[cavcol])}
            tok.setdefault('all_cavities_listed', 0)
            tok['all_cavities_listed'] += int(allcav)

    res = {
        'tokujuten': tok,
        'terciles': terciles,
        'source': {
            'mlit02': 'https://www.mlit.go.jp/road/sisaku/ijikanri/xlsx/dourokanbotsu/r6/02.xlsx',
            'sewer': 'https://data.bodik.jp/dataset/272035_gesuido',
            'chome': 'e-Stat 令和2年国勢調査 小地域（町丁・字等）境界 豊中市（https://www.e-stat.go.jp/gis）',
        },
        'columns_in_02': ['道路管理者', '路線名', '地名（市区町村＋町名＋地先）', '要因施設', '深さ・縦断方向・横断方向(m)'],
        'has_coordinates': False,
        'national': national,
        'osaka': {'total': osaka_total, 'sewer': osaka_sewer, 'municipal': len(osaka), 'prefecture': len(osaka_pref),
                  'toyonaka': len(toy)},
        'toyonaka': {
            'incidents': len(toy),
            'sewer': sum(1 for r in toy if r['cause'] == '下水道'),
            'causes': dict(collections.Counter(r['cause'] for r in toy).most_common()),
            'unmatched_town': dict(unmatched),
            'towns_with_polygon': len(town_names),
            'towns_with_incident': sum(1 for t in towns if t['incidents'] > 0),
            'pipe_count': n_pipes,
            'pipe_km_total': round(total_m / 1000, 1),
            'pipe_km_outside_town_polygons': round(outside_m / 1000, 1),
        },
        'check': {
            'min_km': a.min_km,
            'towns_used': len(use),
            'towns_used_with_sewer_incident': len(pos),
            'incidents_used': sum(t['sewer_incidents'] for t in use),
            'spearman_age_vs_rate': None if rho is None else round(rho, 3),
            'auc_age_for_towns_with_sewer_incident': None if A is None else round(A, 3),
            'perm_trials': N,
            'perm_p_rho_ge': ge_rho / N,
            'perm_p_auc_ge': ge_auc / N,
        },
        'towns': sorted(towns, key=lambda t: (-t['sewer_incidents'], t['town'])),
    }
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
