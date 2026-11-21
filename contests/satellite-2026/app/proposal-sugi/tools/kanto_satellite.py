#!/usr/bin/env python3
"""関東のスギ人工林メッシュ（data/kanto.js の cells）に、Sentinel-2 L2A の冬の NDVI を重ねた集計値 data/sat.js を作る（GET のみ）。
衛星: Sentinel-2 L2A（ESA／Copernicus。Element 84 Earth Search の公開 COG、STAC 検索と COG の一部読み取りだけ。認証なし）。
  1. 森林簿の答え合わせ: 新しい冬（既定 2026年1〜2月）の NDVI の500mメッシュ平均。冬に緑が弱い所は「要確認」（伐採跡・森林簿とのずれ・広葉樹の混在・影・雪などの可能性。原因は判別しない）。
  2. 伐採跡の候補: 古い冬（既定 2022年1〜2月）と新しい冬の NDVI を同じ画素で比べ、古い冬に緑（NDVI≥GREEN）だった画素が DROP 以上下がった画素を数える（植え替えの進み具合の目安）。
  しきい値 GREEN・DROP は仮置き（画面と README に「仮」と明記）。
処理: タイル(MGRS)ごとに、雲量が最小の1シーンを冬ごとに選ぶ（ただし、撮影範囲がタイルの範囲のメッシュの98%以上を覆うシーンに限る。端が欠けたシーンを選ぶと、そのタイルの北や東が見えなくなるため）。赤(B04)・近赤外(B08)・シーン分類(SCL)を COG の概観（40m）で読み、SCL で雲・影・雪などを除く。
  画素の中心の緯度経度から 500mメッシュ（ix=floor(経度*160), iy=floor(緯度*240)）を決めて集計する。隣り合うタイルの重なりは、両方の冬で有効な画素が多いタイルを採る。
  衛星は樹種・林齢・雄花の量を判別できない。メッシュ内にはスギ以外の林・畑・道なども含まれる（20mのスギ画素の位置は同梱していない）。
出力: data/sat.js（window.SUGI_SAT）、<作業ディレクトリ>/sat_scenes.json
使い方: PYTHONPATH=<rasterio の入った場所> python3 -I tools/kanto_satellite.py <作業ディレクトリ> [--list]
"""
import json, math, os, sys, time, urllib.parse, urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAC = 'https://earth-search.aws.element84.com/v1/search'
OLD = ('2022-01-05T00:00:00Z', '2022-02-20T23:59:59Z')
NEW = ('2026-01-05T00:00:00Z', '2026-02-20T23:59:59Z')
GREEN = 0.5          # 古い冬に「緑（常緑）だった」とみなす NDVI（仮）
DROP = 0.3           # これ以上下がった画素を「伐採・植え替えの候補」とする NDVI の差（仮）
MIN_PX = 20          # メッシュの平均を採る最小の有効画素数（40m 画素 = 0.16 ha なので約3ha）
BAD_SCL = (0, 1, 3, 8, 9, 10, 11)  # 欠測・飽和・雲影・雲(中/高確率)・薄雲・雪氷


def load_cells():
    txt = open(os.path.join(ROOT, 'data', 'kanto.js'), encoding='utf-8').read()
    d = json.loads(txt[txt.index('window.SUGI_KANTO = ') + len('window.SUGI_KANTO = '):].rstrip().rstrip(';'))
    return np.array(d['cells']['ix']), np.array(d['cells']['iy'])


def search(rng, bbox):
    """期間内のシーンを（ページをたどって）全部取り、MGRS タイルごとのシーンの一覧を返す（COG でないものは除く）。"""
    out, count = {}, 0
    q = {'collections': 'sentinel-2-l2a', 'bbox': ','.join(map(str, bbox)), 'datetime': rng[0] + '/' + rng[1], 'limit': 100}
    url = STAC + '?' + urllib.parse.urlencode(q)
    while url:
        with urllib.request.urlopen(url, timeout=90) as r:
            d = json.load(r)
        for f in d['features']:
            count += 1
            if not all(f['assets'].get(k, {}).get('href', '').endswith('.tif') for k in ('red', 'nir', 'scl')):
                continue  # COG でないシーン（jp2 のみ）は読めないので除く
            t = f['properties'].get('grid:code')
            if t:
                out.setdefault(t, []).append(f)
        url = next((l['href'] for l in d.get('links', []) if l.get('rel') == 'next' and l.get('method', 'GET') == 'GET'), None)
    return out, count


def https(href):
    """s3://bucket/key の href は、公開バケットの https に直す（認証なしの GET）。"""
    if href.startswith('s3://'):
        b, k = href[5:].split('/', 1)
        return 'https://%s.s3.us-west-2.amazonaws.com/%s' % (b, k)
    return href


def read_bands(item):
    for k in range(3):
        try:
            return read_bands1(item)
        except Exception as e:  # 一時的な通信エラーは再試行
            print('再試行', item['id'], str(e)[:100], flush=True)
            time.sleep(5)
    return read_bands1(item)


def read_bands1(item):
    import rasterio
    from rasterio.enums import Resampling
    res = {}
    for key in ('red', 'nir', 'scl'):
        with rasterio.open(https(item['assets'][key]['href'])) as ds:
            h, w = ds.height, ds.width
            if key == 'scl':   # SCL は 20m。他の 10m を 40m にするので 1/2 に縮める
                shape = (h // 2, w // 2)
            else:
                shape = (h // 4, w // 4)
            res[key] = ds.read(1, out_shape=shape, resampling=Resampling.nearest)
            if key == 'red':
                t, crs, full = ds.transform, ds.crs, (h // 4, w // 4)
    return res, t, crs, full


def ndvi_valid(b):
    red, nir, scl = b['red'].astype('float32'), b['nir'].astype('float32'), b['scl']
    s = scl[:red.shape[0], :red.shape[1]]
    ok = ~np.isin(s, BAD_SCL) & ((red + nir) > 0) & (red > 0)
    nd = np.where(ok, (nir - red) / np.where(red + nir == 0, 1, red + nir), np.nan).astype('float32')
    return nd


def main(work, list_only=False):
    os.makedirs(work, exist_ok=True)
    ix, iy = load_cells()
    lon0, lon1 = ix.min() / 160, (ix.max() + 1) / 160
    lat0, lat1 = iy.min() / 240, (iy.max() + 1) / 240
    bbox = (lon0, lat0, lon1, lat1)
    oldall, n1 = search(OLD, bbox)
    newall, n2 = search(NEW, bbox)
    cx, cy = (ix + 0.5) / 160, (iy + 0.5) / 240
    inside = lambda bb: int(((cx >= bb[0]) & (cx <= bb[2]) & (cy >= bb[1]) & (cy <= bb[3])).sum())
    old, new, tiles = {}, {}, []
    for t in sorted(set(oldall) & set(newall)):
        # シーンの bbox は撮影された範囲で、タイル全体より狭いことがある（端が欠けたシーン）。
        # 両期間のシーンの bbox を合わせた範囲を「タイルの範囲」とし、その中のメッシュの98%以上を覆うシーンの中で雲量が最小のものを採る。
        allf = oldall[t] + newall[t]
        ext = (min(f['bbox'][0] for f in allf), min(f['bbox'][1] for f in allf), max(f['bbox'][2] for f in allf), max(f['bbox'][3] for f in allf))
        full = inside(ext)
        if full == 0:
            continue
        pick = lambda fs: min((f for f in fs if inside(f['bbox']) >= 0.98 * full), key=lambda f: f['properties']['eo:cloud_cover'], default=None)
        o, nw = pick(oldall[t]), pick(newall[t])
        if o is None or nw is None:
            print('警告: タイルを覆うシーンがない', t, full, flush=True)
            continue
        old[t], new[t] = o, nw
        tiles.append(t)
    print('候補', n1, n2, 'タイル', tiles, '片方のみ', sorted(set(old) ^ set(new)))
    scenes = {t: {'old': {'id': old[t]['id'], 'date': old[t]['properties']['datetime'][:10], 'cloud': round(old[t]['properties']['eo:cloud_cover'], 1)},
                  'new': {'id': new[t]['id'], 'date': new[t]['properties']['datetime'][:10], 'cloud': round(new[t]['properties']['eo:cloud_cover'], 1)}} for t in tiles}
    for t in tiles:
        print(t, scenes[t])
    if list_only:
        return
    import pyproj
    n = len(ix)
    gy0, gx0 = iy.min(), ix.min()
    lut = np.full((iy.max() - gy0 + 1, ix.max() - gx0 + 1), -1, dtype=np.int32)
    lut[iy - gy0, ix - gx0] = np.arange(n)
    best = {k: np.zeros(n, dtype=np.int32) for k in ('nb', 'na', 'nboth', 'ndrop')}
    sums = {k: np.zeros(n) for k in ('sb', 'sa')}
    for t in tiles:
        t0 = time.time()
        bn, tr, crs, shape = read_bands(new[t]); bo, tr2, _, shape2 = read_bands(old[t])
        assert shape == shape2 and tr == tr2, (t, shape, shape2)
        nb, na = ndvi_valid(bn), ndvi_valid(bo)
        h, w = shape
        # 画素の中心 → 緯度経度 → 500mメッシュ
        px = tr.a * 4; py = tr.e * 4   # 10m の画素を 4 つ分まとめて読んでいる（40m）
        xs = tr.c + (np.arange(w) + 0.5) * px
        ys = tr.f + (np.arange(h) + 0.5) * py
        to_ll = pyproj.Transformer.from_crs(crs, 4326, always_xy=True)
        res = {k: np.zeros(n, dtype=np.int32) for k in best}; rs = {k: np.zeros(n) for k in sums}
        for r0 in range(0, h, 256):
            r1 = min(h, r0 + 256)
            X, Y = np.meshgrid(xs, ys[r0:r1])
            lon, lat = to_ll.transform(X, Y)
            cx = np.floor(lon * 160).astype(np.int64) - gx0; cy = np.floor(lat * 240).astype(np.int64) - gy0
            inb = (cx >= 0) & (cx < lut.shape[1]) & (cy >= 0) & (cy < lut.shape[0])
            cell = np.full(cx.shape, -1, dtype=np.int32); cell[inb] = lut[cy[inb], cx[inb]]
            m = cell >= 0
            if not m.any():
                continue
            c = cell[m]; a = na[r0:r1][m]; b = nb[r0:r1][m]
            va, vb = ~np.isnan(a), ~np.isnan(b); both = va & vb
            drop = both & (a >= GREEN) & ((a - b) >= DROP)
            res['nb'] += np.bincount(c[vb], minlength=n).astype(np.int32); res['na'] += np.bincount(c[va], minlength=n).astype(np.int32)
            res['nboth'] += np.bincount(c[both], minlength=n).astype(np.int32); res['ndrop'] += np.bincount(c[drop], minlength=n).astype(np.int32)
            rs['sb'] += np.bincount(c[vb], weights=b[vb], minlength=n); rs['sa'] += np.bincount(c[va], weights=a[va], minlength=n)
        take = res['nboth'] > best['nboth']
        for k in best:
            best[k] = np.where(take, res[k], best[k])
        for k in sums:
            sums[k] = np.where(take, rs[k], sums[k])
        print(t, '読み取り・集計', round(time.time() - t0), '秒', 'メッシュ(有効)', int((res['nboth'] >= MIN_PX).sum()), flush=True)
    wb = np.where(best['nb'] >= MIN_PX, np.round(sums['sb'] / np.maximum(best['nb'], 1) * 100), -999).astype(int)
    wa = np.where(best['na'] >= MIN_PX, np.round(sums['sa'] / np.maximum(best['na'], 1) * 100), -999).astype(int)
    meta = {'sensor': 'Sentinel-2 L2A（ESA／Copernicus。Element 84 Earth Search の公開COG）', 'pixelM': 40, 'pixelHa': 0.16, 'green': GREEN, 'drop': DROP, 'minPx': MIN_PX,
            'old': OLD[0][:7] + '〜' + OLD[1][:7], 'new': NEW[0][:7] + '〜' + NEW[1][:7], 'scenes': scenes, 'built': time.strftime('%Y-%m-%d')}
    data = {'meta': meta, 'wNew': wb.tolist(), 'wOld': wa.tolist(), 'nValid': best['nb'].tolist(), 'nBoth': best['nboth'].tolist(), 'nDrop': best['ndrop'].tolist()}
    with open(os.path.join(ROOT, 'data', 'sat.js'), 'w', encoding='utf-8') as f:
        f.write('// tools/kanto_satellite.py が生成。Sentinel-2 L2A（ESA／Copernicus Sentinel データを加工）の冬の NDVI を500mメッシュごとに集計した実データ。手で編集しない。\n')
        f.write('window.SUGI_SAT = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    json.dump(scenes, open(os.path.join(work, 'sat_scenes.json'), 'w'), ensure_ascii=False, indent=1)
    print('wrote data/sat.js', os.path.getsize(os.path.join(ROOT, 'data', 'sat.js')) / 1e6, 'MB')


if __name__ == '__main__':
    main(sys.argv[1], '--list' in sys.argv)
