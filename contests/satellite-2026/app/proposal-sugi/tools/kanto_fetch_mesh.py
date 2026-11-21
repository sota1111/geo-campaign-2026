#!/usr/bin/env python3
"""林野庁 全国森林資源メッシュ（G空間情報センター dataset mesh_9、平面直角座標系IX系、20m）のうち、関東1都6県にかかる図郭の
7z を GET で取得して gpkg に展開する（取得のみ。POST・ログインなし）。py7zr が必要。
使い方: python3 -I tools/kanto_fetch_mesh.py <出力ディレクトリ> [list|get]
出典: 林野庁 全国森林資源メッシュ https://www.geospatial.jp/ckan/dataset/mesh_9 （公共データ利用規約 第1.0版、利用規約は2026-11-21確認）
"""
import json, os, re, sys, time, urllib.request

API = 'https://www.geospatial.jp/ckan/api/3/action/package_show?id=mesh_9'
UA = {'User-Agent': 'Mozilla/5.0 (sugi-demo data builder)'}
# 関東1都6県の外枠（島しょを除く）に少しかかる図郭まで含める。ここでは余りを含めるだけで、都県の判定は後段（都道府県コード）で行う。
LON0, LON1, LAT0, LAT1 = 138.35, 140.95, 34.85, 37.15


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)


def tiles(out):
    """図郭割 gpkg の範囲と突き合わせて、関東にかかる図郭の (図郭番, url) を返す。"""
    import fiona
    from pyproj import Transformer
    pkg = json.load(get(API))['result']
    res = pkg['resources']
    idx_url = [r['url'] for r in res if r['name'].startswith('図郭割データ')][0]
    p = os.path.join(out, 'index.gpkg')
    if not os.path.exists(p):
        open(p, 'wb').write(get(idx_url).read())
    tr = Transformer.from_crs(6677, 4326, always_xy=True)
    ext = {}
    with fiona.open(p) as s:
        for f in s:
            g = f['geometry']['coordinates']
            xs = [c[0] for poly in g for c in poly[0]]
            ys = [c[1] for poly in g for c in poly[0]]
            lo = tr.transform(min(xs), min(ys)); hi = tr.transform(max(xs), max(ys))
            ext[f['properties']['図郭名']] = (lo, hi)
    sel = []
    for r in res:
        if not r['url'].endswith('.7z'):
            continue
        n = re.search(r'_([0-9A-Z]+)_2025', r['name']).group(1)
        if n not in ext:
            continue
        lo, hi = ext[n]
        if hi[0] > LON0 and lo[0] < LON1 and hi[1] > LAT0 and lo[1] < LAT1:
            sel.append((n, r['url'], int(r.get('size') or 0)))
    return sorted(sel)


def main(out, mode='get'):
    os.makedirs(out, exist_ok=True)
    sel = tiles(out)
    print(len(sel), 'tiles', sum(s[2] for s in sel) / 1e6, 'MB')
    if mode == 'list':
        for s in sel:
            print(s[0], s[2])
        return
    import py7zr
    for n, url, size in sel:
        d = os.path.join(out, n)
        if os.path.isdir(d) and any(f.endswith('.gpkg') for f in os.listdir(d)):
            continue
        z = os.path.join(out, n + '.7z')
        for k in range(5):  # 一時的な 403/タイムアウトは待って再試行
            try:
                with get(url) as r, open(z, 'wb') as w:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        w.write(b)
                break
            except Exception as e:
                print('retry', n, k, e, flush=True)
                time.sleep(20 * (k + 1))
        else:
            raise SystemExit('取得に失敗: ' + n)
        os.makedirs(d, exist_ok=True)
        with py7zr.SevenZipFile(z) as a:
            a.extractall(d)
        os.remove(z)
        print('ok', n, flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'get')
