#!/usr/bin/env python3
"""東京23区の「地区」の境界を web/data/districts.json に書く前処理（通信しない）。

入力: e-Stat 境界データ（国勢調査 2020年 小地域（町丁・字等）、世界測地系・緯度経度、Shape形式）の r2ka13.shp / r2ka13.dbf（東京都）。
      https://www.e-stat.go.jp/gis/statmap-search?type=2  （出典: 「政府統計の総合窓口(e-Stat)」の境界データを加工して作成）
      web/data/price-districts.json（tools/fetch.mjs の出力。XIT001 の地区名の一覧と件数に使う）。
使い方: python3 -I tools/build-districts.py <r2ka13.shp> [出力先]

やること:
  1. 小地域の名前から「◯丁目」を外した町名（例: 西新宿一丁目 → 西新宿）で、区ごとに束ねる。
  2. XIT001 の「地区名（DistrictName）」と、区コードが同じで町名が同じものを突き合わせる（ヶ/ケ/ヵ の違いだけ吸収）。
  3. 隣り合う地区の境界を共有したまま簡略化する（境界線を節で切り、1本ずつ単純化して、面を組み直す）。隙間・重なりを作らない。
  4. 座標を 1e-5 度（約1m）の整数に丸め、差分で書く。突き合わせ率を一緒に書く。
測量・権利の根拠ではない簡略図。
"""
import json, os, re, struct, sys
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union, linemerge, polygonize
from shapely import STRtree

TOL = 0.00007   # 度。約7m
Q = 100000      # 座標の量子化（1e-5度）
OX, OY = 139.0, 35.0
HERE = os.path.dirname(os.path.abspath(__file__))


def read_dbf(path):
    f = open(path, 'rb')
    h = f.read(32)
    n, hl, rl = struct.unpack('<IHH', h[4:12])
    fields = []
    while True:
        d = f.read(32)
        if d[0] == 0x0d:
            break
        fields.append((d[:11].split(b'\0')[0].decode(), d[16]))
    rows = []
    for i in range(n):
        f.seek(hl + i * rl)
        r = f.read(rl)
        o = 1
        row = {}
        for nm, l in fields:
            row[nm] = r[o:o + l].decode('cp932', 'replace').strip()
            o += l
        rows.append(row)
    return rows


def read_shp(path):
    b = open(path, 'rb').read()
    off = 100
    out = []
    while off < len(b):
        _, clen = struct.unpack('>ii', b[off:off + 8])
        off += 8
        end = off + clen * 2
        t = struct.unpack('<i', b[off:off + 4])[0]
        if t != 5:
            out.append(None)
            off = end
            continue
        np_, npt = struct.unpack('<ii', b[off + 36:off + 44])
        parts = list(struct.unpack('<%di' % np_, b[off + 44:off + 44 + 4 * np_])) + [npt]
        pts = struct.unpack('<%dd' % (2 * npt), b[off + 44 + 4 * np_:off + 44 + 4 * np_ + 16 * npt])
        rings = [[(pts[2 * k], pts[2 * k + 1]) for k in range(parts[i], parts[i + 1])] for i in range(np_)]
        out.append(rings)
        off = end
    return out


def to_geom(rings):
    outers, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        a = sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))
        (outers if a < 0 else holes).append(Polygon(r))  # Shape は外周が時計回り
    g = unary_union([shapely.make_valid(p) for p in outers])
    if holes:
        g = g.difference(unary_union([shapely.make_valid(p) for p in holes]))
    return g


KAN = '一二三四五六七八九十'


def base_name(s):
    return re.sub('[' + KAN + ']+丁目$', '', s)


def norm(s):
    # 表記ゆれだけを吸収する: ケ/ヵ→ヶ、異体字（濤→涛、鶯→鴬）
    return s.replace('ケ', 'ヶ').replace('ヵ', 'ヶ').replace('ｹ', 'ヶ').replace('濤', '涛').replace('鶯', '鴬')


# 町名の表記が違うだけで同じ町（千代田区に同名の町が他にない）と確認できたもの。（区コード, XIT001の地区名）→ 小地域の町名
ALIAS = {('13101', '神田猿楽町'): '猿楽町', ('13101', '神田三崎町'): '三崎町'}


def rings_of(g):
    polys = [g] if g.geom_type == 'Polygon' else [p for p in g.geoms if p.geom_type == 'Polygon']
    out = []
    for p in polys:
        for r in [p.exterior, *p.interiors]:
            out.append(list(r.coords))
    return out


def enc(ring):
    pts = [(round((x - OX) * Q), round((y - OY) * Q)) for x, y in ring]
    dedup = [pts[0]]
    for p in pts[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 4:
        return None
    flat = [dedup[0][0], dedup[0][1]]
    for i in range(1, len(dedup)):
        flat += [dedup[i][0] - dedup[i - 1][0], dedup[i][1] - dedup[i - 1][1]]
    return flat


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    shp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '../web/data/districts.json')
    price = json.load(open(os.path.join(HERE, '../web/data/price-districts.json'), encoding='utf-8'))
    rows = read_dbf(shp[:-4] + '.dbf')
    geoms = read_shp(shp)
    assert len(rows) == len(geoms)
    groups, wname = {}, {}
    for r, rings in zip(rows, geoms):
        k = r['KEY_CODE']
        if not (k.startswith('13') and '101' <= r['CITY'] <= '123' and r['S_NAME'] and rings):
            continue
        if int(r['HCODE'] or 0) == 8154:
            continue  # 水面調査区
        code = '13' + r['CITY']
        wname[code] = r['CITY_NAME']
        groups.setdefault((code, base_name(r['S_NAME'])), []).append(to_geom(rings))
    assert len(wname) == 23, len(wname)
    dist = {k: unary_union(v) for k, v in groups.items()}
    keys = sorted(dist)
    # 境界線を共有したまま簡略化
    nodes = unary_union([dist[k].boundary for k in keys])
    merged = linemerge(nodes) if nodes.geom_type != 'LineString' else nodes
    lines = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    simp = [l.simplify(TOL, preserve_topology=True) for l in lines]
    faces = list(polygonize(unary_union(simp)))
    tree = STRtree([dist[k] for k in keys])
    by = {}
    for fc in faces:
        p = fc.representative_point()
        for i in tree.query(p, predicate='within'):
            by.setdefault(keys[i], []).append(fc)
            break
    new = {k: unary_union(by[k]) for k in keys if k in by}
    lost = [k for k in keys if k not in new]
    # 突き合わせ
    pnames = {c: list(price['districts'][c].keys()) for c in price['districts']}
    recent = {}  # 直近の窓（最後の年）の「すべて」の件数
    for c, d in price['districts'].items():
        for nm, plans in d.items():
            recent[(c, nm)] = plans[0][-2] if plans[0] else 0
    have = {(c, norm(b)): (c, b) for (c, b) in new}
    matched, unmatched = {}, []
    for c, names in pnames.items():
        for nm in names:
            h = have.get((c, norm(ALIAS.get((c, nm), nm))))
            if h:
                matched[(c, nm)] = h
            else:
                unmatched.append((c, nm))
    mapped_keys = set(matched.values())
    n_price = sum(len(v) for v in pnames.values())
    t_all = sum(recent.values())
    t_ok = sum(recent[k] for k in matched)
    # 出力
    wards_geom = {}
    for (c, b), g in new.items():
        wards_geom.setdefault(c, []).append(g)
    wards = []
    for c in sorted(wards_geom):
        g = unary_union(wards_geom[c]).buffer(0)
        wards.append({'code': c, 'name': wname[c], 'p': [e for e in (enc(r) for r in rings_of(g)) if e]})
    inv = {v: k for k, v in matched.items()}
    dlist = []
    for (c, b) in sorted(new):
        nm = inv.get((c, b))
        dlist.append({'code': c, 'name': b, 'price': nm[1] if nm else None, 'p': [e for e in (enc(r) for r in rings_of(new[(c, b)])) if e]})
    data = {
        'source': '政府統計の総合窓口（e-Stat）境界データ「国勢調査 2020年 小地域（町丁・字等）」東京都（世界測地系・緯度経度）を加工して作成。簡略図',
        'origin': [OX, OY], 'q': Q, 'tolDeg': TOL,
        'match': {
            'priceDistricts': n_price, 'matched': len(matched), 'unmatched': len(unmatched),
            'rateByName': round(len(matched) / n_price, 4),
            'recentTrades': t_all, 'recentTradesMatched': t_ok, 'rateByTrades': round(t_ok / t_all, 4),
            'boundaryDistricts': len(new), 'boundaryWithoutPrice': len(new) - len(mapped_keys),
            'unmatchedList': sorted([[c, nm, recent[(c, nm)]] for c, nm in unmatched], key=lambda x: -x[2]),
        },
        'wards': wards, 'districts': dlist,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    s = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    open(out, 'w', encoding='utf-8').write(s)
    m = data['match']
    print('書き出しました: %s（%.0fKB）' % (out, len(s.encode()) / 1024))
    print('小地域→町名 %d地区、簡略化後 %d地区（失われた %d）、面 %d、線 %d' % (len(dist), len(new), len(lost), len(faces), len(lines)))
    print('地区名の突き合わせ: %d/%d（%.1f%%）。直近5年の取引件数ベース %d/%d（%.1f%%）。境界のみ（取引なし）%d地区' % (m['matched'], n_price, 100 * m['rateByName'], t_ok, t_all, 100 * m['rateByTrades'], m['boundaryWithoutPrice']))
    print('合わなかった上位:', m['unmatchedList'][:25])


if __name__ == '__main__':
    main()
