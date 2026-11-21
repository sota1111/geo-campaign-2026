#!/usr/bin/env python3
"""取得済みの生データ（tools/cache/）から data/toyonaka.json を作る。
  1. GSI 干渉SAR タイル(qu) -> 約90m 区画の階級（insar_cells.py）
  2. OSM 道路 -> 交差点・長さ・曲がりで区間に分割
  3. 豊中市 下水道 管渠（シェープ, EPSG:6674）-> 竣工年・管径を、道路区間に最近傍で紐づけ
  4. 地中レーダ結果 sim_cavity だけは乱数（固定シード）。実データではない。
usage: python3 -I tools/build_data.py > data/toyonaka.json   （標準出力に JSON、統計は標準エラー）
"""
import collections, json, math, os, random, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insar_cells as ic
import shp
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
BBOX = (135.470, 34.795, 135.510, 34.825)  # (west, south, east, north) 豊中市北東部（千里地区周辺）
MATCH_M = 15.0           # 道路区間と管渠を紐づける距離（m）
SERVICE_M = 100.0        # これより遠い区間は「台帳の対象範囲の外」として画面に出さない
MAX_SEG_M = 150.0        # 区間の最大長
MAX_DEV_M = 6.0          # 弦からの最大ずれ
MIN_SEG_M = 8.0
SEED = 20261121
ARTERIAL = {'trunk', 'primary', 'secondary', 'tertiary'}
LIFE = {'unclassified', 'residential', 'living_street'}

to_xy = Transformer.from_crs('EPSG:4326', 'EPSG:6674', always_xy=True)
to_ll = Transformer.from_crs('EPSG:6674', 'EPSG:4326', always_xy=True)


def d_pt_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def polylen(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def split_piece(pts):
    """曲がり・長さで再帰的に分割。pts は (x,y) の列。戻りは頂点列のリスト。"""
    if len(pts) < 2:
        return []
    L = polylen(pts)
    a, b = pts[0], pts[-1]
    dev, idx = 0.0, None
    for i in range(1, len(pts) - 1):
        d = d_pt_seg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1])
        if d > dev:
            dev, idx = d, i
    if len(pts) > 2 and (dev > MAX_DEV_M or L > MAX_SEG_M):
        if dev <= MAX_DEV_M:  # 長いだけ: 道なり中点に最も近い頂点で割る
            acc, half, idx = 0.0, L / 2, 1
            for i in range(1, len(pts) - 1):
                acc += math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
                idx = i
                if acc >= half:
                    break
        return split_piece(pts[:idx + 1]) + split_piece(pts[idx:])
    if L > MAX_SEG_M and len(pts) == 2:  # 直線で長い: 等分
        n = math.ceil(L / MAX_SEG_M)
        return [[(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n),
                 (a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n)] for i in range(n)]
    return [pts]


def main():
    rng = random.Random(SEED)
    stats = {}
    w, s, e, n = BBOX

    # ---- 1. 衛星の区画
    cls, origin = ic.load_class_mosaic(BBOX)
    cells = ic.grid_cells(cls, origin, BBOX, (s + n) / 2)
    cell_by_rc = {(c['r'], c['c']): c for c in cells}
    for c in cells:
        c['id'] = f"r{c['r']:02d}c{c['c']:02d}"
    dlon, dlat = cells[0]['dlon'], cells[0]['dlat']
    stats['cells'] = len(cells)
    stats['cell_class_counts'] = {str(k): v for k, v in sorted(collections.Counter(c['k'] for c in cells).items())}
    stats['pixel_class_counts'] = {str(k): int(v) for k, v in sorted(collections.Counter(cls[cls >= 0].ravel().tolist()).items())}

    # ---- 3a. 下水道（先に読む）
    m = 400.0
    x0, y0 = to_xy.transform(w, s); x1, y1 = to_xy.transform(e, n)
    xmin, xmax, ymin, ymax = min(x0, x1) - m, max(x0, x1) + m, min(y0, y1) - m, max(y0, y1) + m
    recs = shp.read_dbf(os.path.join(CACHE, 'sewer', '管渠.dbf'))
    geoms = shp.read_polylines(os.path.join(CACHE, 'sewer', '管渠.shp'))
    pipes, total_pipes, unk_all = [], 0, 0
    for (deleted, row), g in zip(recs, geoms):
        total_pipes += 1
        if row['SYUNKOU_BI'].startswith('9999'):
            unk_all += 1
        if deleted or not g:
            continue
        yr = int(row['SYUNKOU_BI'][:4]) if row['SYUNKOU_BI'][:4].isdigit() else 9999
        yr = None if yr >= 9999 or yr < 1900 else yr
        try:
            dia = int(float(row['HYOUJI_KEI']))
        except ValueError:
            dia = None
        for part in g:
            for a, b in zip(part, part[1:]):
                if xmin <= a[0] <= xmax and ymin <= a[1] <= ymax:
                    pipes.append((a[0], a[1], b[0], b[1], yr, dia))
    stats['sewer_total_records'] = total_pipes
    stats['sewer_unknown_year_all'] = unk_all
    stats['sewer_pieces_near_area'] = len(pipes)
    G = 50.0
    idx = collections.defaultdict(list)
    for i, p in enumerate(pipes):
        for gx in range(int(min(p[0], p[2]) // G) - 1, int(max(p[0], p[2]) // G) + 2):
            for gy in range(int(min(p[1], p[3]) // G) - 1, int(max(p[1], p[3]) // G) + 2):
                idx[(gx, gy)].append(i)

    def nearest(px, py, rmax):
        best, bd = None, rmax
        r = int(rmax // G) + 1
        gx0, gy0 = int(px // G), int(py // G)
        seen = set()
        for gx in range(gx0 - r, gx0 + r + 1):
            for gy in range(gy0 - r, gy0 + r + 1):
                for i in idx.get((gx, gy), ()):
                    if i in seen:
                        continue
                    seen.add(i)
                    p = pipes[i]
                    d = d_pt_seg(px, py, p[0], p[1], p[2], p[3])
                    if d < bd:
                        best, bd = i, d
        return best, bd

    # ---- 2. 道路を区間に
    osm = json.load(open(os.path.join(CACHE, 'osm.json')))
    ways = osm['elements']
    node_use = collections.Counter()
    for wy in ways:
        for nid in wy.get('nodes', []):
            node_use[nid] += 1
    pieces = []  # (way_id, highway, pts_xy)
    for wy in ways:
        hw = wy['tags']['highway']
        nodes, geom = wy.get('nodes', []), wy.get('geometry', [])
        if len(nodes) != len(geom) or len(geom) < 2:
            continue
        xy = [to_xy.transform(g['lon'], g['lat']) for g in geom]
        cut = [0] + [i for i in range(1, len(nodes) - 1) if node_use[nodes[i]] >= 2] + [len(nodes) - 1]
        for a, b in zip(cut, cut[1:]):
            for pc in split_piece(xy[a:b + 1]):
                pieces.append((wy['id'], hw, pc, wy['tags'].get('name', '')))
    stats['osm_ways'] = len(ways)
    stats['osm_pieces_all'] = len(pieces)

    # ---- 4. 紐づけ
    rates = {t: [0, 0] for t in (10, 15, 25)}
    segs, no_cell, out_of_service, dropped_short = [], 0, 0, 0
    for way_id, hw, pc, wname in pieces:
        L = polylen(pc)
        if L < MIN_SEG_M:
            dropped_short += 1
            continue
        a, b = pc[0], pc[-1]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        mlon, mlat = to_ll.transform(mx, my)
        c = cell_by_rc.get((int((mlat - s) / dlat), int((mlon - w) / dlon)))
        # サンプル点（道なり約10mごと）
        samples, acc, step = [], 0.0, 10.0
        for p, q in zip(pc, pc[1:]):
            sl = math.hypot(q[0] - p[0], q[1] - p[1])
            k = max(1, int(sl // step))
            for j in range(k):
                t = (j + 0.5) / k
                samples.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        hit = collections.Counter()
        near_any = 0
        dmin = 1e9
        for sx, sy in samples:
            i, d = nearest(sx, sy, SERVICE_M)
            if i is not None:
                near_any += 1
                dmin = min(dmin, d)
            if i is not None and d <= MATCH_M:
                hit[i] += 1
        if not near_any:
            out_of_service += 1
            continue
        if c is None:
            no_cell += 1
            continue
        frac = lambda t: sum(1 for sx, sy in samples if (lambda r: r[0] is not None and r[1] <= t)(nearest(sx, sy, t))) / len(samples)
        for t in rates:
            rates[t][1] += 1
            if frac(t) >= 0.5:
                rates[t][0] += 1
        arterial = hw in ARTERIAL
        matched = sum(hit.values()) / len(samples) >= 0.5
        ys = [pipes[i][4] for i in hit for _ in range(hit[i]) if pipes[i][4] is not None]
        year = int(statistics.median(ys)) if matched and ys else None
        dias = [pipes[i][5] for i in hit if pipes[i][5]]
        dia = max(dias) if matched and dias else None
        lo, la = to_ll.transform(*a); lo2, la2 = to_ll.transform(*b)
        segs.append({'way': way_id, 'hw': hw, 'name': wname, 'cell': c, 'arterial': arterial, 'matched': matched,
                     'year': year, 'dia': dia, 'lenM': round(L), 'dmin': dmin,
                     'coords': [[round(lo, 6), round(la, 6)], [round(lo2, 6), round(la2, 6)]]})
    stats['osm_pieces_dropped_short'] = dropped_short
    stats['osm_pieces_outside_ledger_100m'] = out_of_service
    stats['osm_pieces_no_satellite_cell'] = no_cell
    stats['match_rate_by_threshold'] = {f'{t}m': {'matched': v[0], 'of': v[1], 'rate': round(v[0] / v[1], 4)} for t, v in rates.items()}

    # ---- 出力用に整形（地中レーダ結果 sim_cavity は乱数＝架空）
    out_segs = []
    for i, sg in enumerate(segs):
        k = sg['cell']['k']
        disp = ic.class_mid(k)
        age = 0.5 if sg['year'] is None else max(0.0, min(1.0, (2026 - sg['year']) / 60))
        local = rng.random()
        # 衛星の階級は使わない（この地区の衛星に意味のある差はなく、架空の結果を衛星と相関させると誤解を招くため）。台帳の古さ・管径・区間ごとの局所差だけで作る。
        dia_term = 0.04 if (sg["dia"] or 9999) <= 250 else 0.0
        p = 0.45 * (0.02 + 0.28 * age * age + dia_term + 0.06 * local)
        cav = rng.random() < p
        if sg['arterial']:
            cls_, surveyed = 'arterial', True
        elif sg['matched']:
            cls_, surveyed = 'life', rng.random() < 0.06
        else:
            cls_, surveyed = 'noledger', False
        out_segs.append({'id': f'S{i + 1:04d}', 'cls': cls_, 'cell': sg['cell']['id'], 'year': sg['year'], 'dia': sg['dia'],
                         'lenM': sg['lenM'], 'hw': sg['hw'], **({'name': sg['name']} if sg['name'] else {}), 'surveyed': surveyed, 'sim_cavity': cav, 'coords': sg['coords']})
    stats['segments'] = len(out_segs)
    stats['segments_by_cls'] = dict(collections.Counter(s['cls'] for s in out_segs))
    life = [s for s in out_segs if s['cls'] == 'life']
    stats['life_year_unknown'] = sum(1 for s in life if s['year'] is None)
    stats['life_year_known'] = len(life) - stats['life_year_unknown']
    stats['life_km'] = round(sum(s['lenM'] for s in life) / 1000, 1)
    stats['arterial_km'] = round(sum(s['lenM'] for s in out_segs if s['cls'] == 'arterial') / 1000, 1)
    stats['noledger_km'] = round(sum(s['lenM'] for s in out_segs if s['cls'] == 'noledger') / 1000, 1)
    yrs = [s['year'] for s in life if s['year']]
    stats['life_year_range'] = [min(yrs), max(yrs)] if yrs else None
    used_cells = {s['cell'] for s in out_segs}

    out_cells = []
    for c in cells:
        if c['id'] not in used_cells:
            continue
        lo0, la0, lo1, la1 = c['lon0'], c['lat0'], c['lon0'] + dlon, c['lat0'] + dlat
        k = c['k']
        out_cells.append({'id': c['id'], 'cx': c['c'], 'cy': c['r'], 'k': k, 'disp': ic.class_mid(k), 'dispW': ic.CLASS_W,
                          'range': list(ic.class_range(k)),
                          'ring': [[round(lo0, 6), round(la0, 6)], [round(lo1, 6), round(la0, 6)], [round(lo1, 6), round(la1, 6)],
                                   [round(lo0, 6), round(la1, 6)], [round(lo0, 6), round(la0, 6)]]})
    stats['cells_with_roads'] = len(out_cells)
    stats['cell_with_roads_class_counts'] = {str(k): v for k, v in sorted(collections.Counter(c['k'] for c in out_cells).items())}

    result = {
        'note': '実データ（衛星: 国土地理院の干渉SAR成果／道路: OpenStreetMap／下水道台帳: 豊中市）を加工したもの。ただし地中レーダの結果 sim_cavity（と、それに伴う「調査済み」の区分）だけは乱数による架空のシミュレーション。道路形状は © OpenStreetMap contributors の派生データベースで、Open Database License (ODbL) で提供（https://www.openstreetmap.org/copyright）。下水道台帳は豊中市（CC BY 4.0、https://creativecommons.org/licenses/by/4.0/deed.ja）。衛星は 解析：国土地理院 原初データ所有：JAXA。',
        'generator': 'tools/build_data.py（seed %d）' % SEED,
        'area': {'name': '豊中市北東部（千里地区周辺）', 'bbox': list(BBOX)},
        'satellite': {'name': 'ALOS-2/4（Lバンド）干渉SAR、国土地理院解析（準上下方向の変位速度）', 'resolution_m': 90,
                      'class_width_mm_yr': ic.CLASS_W, 'classes': 16, 'range_mm_yr': [-30, 30], 'layer': 'merge_sbas_regular_japan_20260331_qu_u16',
                      'palette': ['#%02x%02x%02x' % tuple(int(v) for v in col) for col in ic.legend_colors()]},
        'stats': stats,
        'cells': out_cells,
        'segments': out_segs,
    }
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(stats, ensure_ascii=False, indent=1), file=sys.stderr)


if __name__ == '__main__':
    main()
