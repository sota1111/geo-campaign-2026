#!/usr/bin/env python3
"""林野庁 全国森林資源メッシュ（G空間情報センター dataset mesh_1〜mesh_19、20m、平面直角座標系の系ごと）を全国分 GET で取得し、
林種=人工林・森林簿樹種1=スギ のメッシュを 500m メッシュ（緯度×240・経度×160 の格子）に集計する。取得のみ（POST・ログインなし）。
図郭ごとに 7z を取得→展開→集計→gpkg 削除、の順で進めるので、ディスクは数GBしか使わない。集計済みの図郭は飛ばす（再開可）。

使い方: python3 -I tools/national_mesh.py <作業ディレクトリ> [並列数=6]
出力: <作業>/agg/<図郭>.json  {"cells": [[key, n, n26, n21, nunk], ...], "tot": 全メッシュ数, "vint": {年: 数}}
  key = floor(緯度*240) * 100000 + floor(経度*160)。n 等は20mメッシュの数（1個 = 0.04 ha）。
  n26 = 森林簿の林齢26以上、n21 = 21以上、nunk = 林齢なし。林齢は森林簿の値（森林簿年月日の時点。今年の林齢ではない）。
py7zr・numpy・pyproj が必要。
出典: 林野庁 全国森林資源メッシュ https://www.geospatial.jp/ckan/dataset/mesh_1 〜 mesh_19（公共データ利用規約 第1.0版＋同メッシュの利用規約）
"""
import collections, concurrent.futures as cf, glob, json, os, re, shutil, sqlite3, sys, time, urllib.request

import numpy as np
from pyproj import Transformer

API = 'https://www.geospatial.jp/ckan/api/3/action/package_show?id=mesh_%d'
UA = {'User-Agent': 'Mozilla/5.0 (sugi-demo data builder)'}


def direct(url):
    """CKAN のダウンロードURL（S3 への署名付きリダイレクト。続けて要求すると403が出る）を、同じファイルの S3 の直接URLに直す。"""
    m = re.search(r'/resource/([0-9a-f-]+)/download/([^/]+)$', url)
    return 'https://gsic-opendata.s3.amazonaws.com/ckan/resources/%s/%s' % (m.group(1), m.group(2)) if m else url


def get(url, tries=6):
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300)
        except Exception as e:
            print('retry', url[-40:], k, e, flush=True)
            time.sleep(15 * (k + 1))
    raise SystemExit('取得に失敗: ' + url)


def resources():
    out = []
    for n in range(1, 20):
        pkg = json.load(get(API % n))['result']
        for r in pkg['resources']:
            if r['url'].endswith('.7z'):
                m = re.search(r'_([0-9A-Z]+)_2025', r['name'])
                out.append((n, m.group(1), r['url'], int(r.get('size') or 0)))
    return out


def aggregate(path, epsg):
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    c = sqlite3.connect(path)
    t = c.execute("select table_name from gpkg_contents where data_type='features'").fetchone()[0]
    rows = c.execute('select substr(geom,9,32), 林齢, 森林簿年月日 from "%s" where 林種=? and 森林簿樹種1=?' % t, ('人工林', 'スギ')).fetchall()
    tot = c.execute('select count(*) from "%s"' % t).fetchone()[0]
    c.close()
    vint = collections.Counter((r[2] or '')[:4] for r in rows)
    if not rows:
        return [], tot, dict(vint)
    env = np.frombuffer(b''.join(r[0] for r in rows), dtype='<f8').reshape(-1, 4)
    x = (env[:, 0] + env[:, 1]) / 2; y = (env[:, 2] + env[:, 3]) / 2
    age = np.array([(-1 if r[1] is None else r[1]) for r in rows])
    lon, lat = to_ll.transform(x, y)
    key = np.floor(lat * 240).astype(np.int64) * 100000 + np.floor(lon * 160).astype(np.int64)
    uk, inv = np.unique(key, return_inverse=True)
    n = np.bincount(inv); n26 = np.bincount(inv, weights=(age >= 26)); n21 = np.bincount(inv, weights=(age >= 21))
    nunk = np.bincount(inv, weights=(age < 0))
    cells = [[int(k), int(n[i]), int(n26[i]), int(n21[i]), int(nunk[i])] for i, k in enumerate(uk.tolist())]
    return cells, tot, dict(vint)


def clean(d):
    """作業用ディレクトリの中身を消す（再帰削除コマンドは使わず、ファイルを1つずつ消す）。"""
    for root, dirs, files in os.walk(d, topdown=False):
        for f in files:
            os.remove(os.path.join(root, f))
        for x in dirs:
            os.rmdir(os.path.join(root, x))
    if os.path.isdir(d):
        os.rmdir(d)


def work(job, work_dir):
    n, name, url, size = job
    out = os.path.join(work_dir, 'agg', name + '.json')
    if os.path.exists(out):
        return name, 'skip'
    tmp = os.path.join(work_dir, 'tmp', name)
    clean(tmp)
    os.makedirs(tmp, exist_ok=True)
    z = os.path.join(tmp, name + '.7z')
    import py7zr
    for k in range(4):
        try:
            with get(direct(url)) as r, open(z, 'wb') as w:
                shutil.copyfileobj(r, w, 1 << 20)
            with py7zr.SevenZipFile(z) as a:
                a.extractall(tmp)
            break
        except Exception as e:  # 一時的な403・途中切断は待って再試行
            print('retry-extract', name, k, e, flush=True)
            time.sleep(20 * (k + 1))
    else:
        return name, 'FAIL'
    g = glob.glob(os.path.join(tmp, '**', '*.gpkg'), recursive=True)
    cells, tot, vint = aggregate(g[0], 6668 + n)
    json.dump({'cells': cells, 'tot': tot, 'vint': vint, 'sys': n}, open(out + '.part', 'w'))
    os.replace(out + '.part', out)
    clean(tmp)
    return name, '%d cells' % len(cells)


def main(work_dir, par=6):
    os.makedirs(os.path.join(work_dir, 'agg'), exist_ok=True)
    jobs = resources()
    print(len(jobs), 'tiles', sum(j[3] for j in jobs) / 1e9, 'GB', flush=True)
    jobs.sort(key=lambda j: -j[3])
    with cf.ProcessPoolExecutor(par) as ex:
        futs = [ex.submit(work, j, work_dir) for j in jobs]
        for i, f in enumerate(cf.as_completed(futs)):
            print(i + 1, '/', len(jobs), *f.result(), flush=True)


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 6)
