#!/usr/bin/env python3
"""関東の「人に届きやすい発生源の順位」用に、各500mメッシュの半径 R km 以内の人口 X_i(R) を作り、data/pop.js に書く（GET のみ）。
人口: e-Stat 地域メッシュ統計 令和2年国勢調査 250mメッシュ（統計表ID T001102、1次メッシュ 5138〜5641 のうち存在するもの、人口総数 T001102001）。
  https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code=<1次メッシュ>&downloadType=2
  人口総数の列が数字のセルをそのまま合計する（秘匿処理の区分は区別しない。総数の列が '*' のセルは数えず、件数を meta に記録。今回は0件）。
計算: 人口を 500mメッシュの格子（lon 1/160度 × lat 1/240度、kanto.js の ix・iy と同じ）に集計し、半径 R km の円板（中心点どうしの距離 ≤ R）を畳み込む。
  距離は 緯度36度の cos で経度を補正した平面近似（kanto-lib.js の haWithin は地点の緯度で補正。差は距離の1〜2%以内）。
  kanto.js の cells と同じ並びで x10/x20/x30 を 100人単位に丸めて書く（順位に影響しない大きさ）。
使い方: python3 -I tools/kanto_pop.py <作業ディレクトリ>   （作業ディレクトリに 1次メッシュの zip を保存・再利用する）
"""
import csv, io, json, math, os, sys, time, urllib.error, urllib.request, zipfile

import numpy as np
from scipy.signal import fftconvolve

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch_population import mesh250_center  # noqa: E402

ROOT = os.path.dirname(HERE)
URL = 'https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code=%s&downloadType=2'
RADII = (10, 20, 30)
UNIT = 100           # 人
KM_DEG = 111.32
COS_REF = math.cos(math.radians(36.0))


def load_cells():
    txt = open(os.path.join(ROOT, 'data', 'kanto.js'), encoding='utf-8').read()
    d = json.loads(txt[txt.index('window.SUGI_KANTO = ') + len('window.SUGI_KANTO = '):].rstrip().rstrip(';'))
    return d['cells']['ix'], d['cells']['iy']


def fetch(code, work):
    p = os.path.join(work, 'm%s.zip' % code)
    if not os.path.exists(p):
        for _ in range(4):
            try:
                req = urllib.request.Request(URL % code, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=300) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None  # 存在しない1次メッシュ（海など）
                time.sleep(3)
            except Exception:
                time.sleep(3)
        else:
            raise RuntimeError('取得できない: ' + code)
        open(p, 'wb').write(data)
    return p


def read_mesh(path):
    z = zipfile.ZipFile(path)
    rd = csv.reader(io.StringIO(z.read(z.namelist()[0]).decode('cp932')))
    next(rd); next(rd)
    out, hidden = [], 0
    for row in rd:
        v = row[4].strip()
        if v.isdigit():
            lat, lon = mesh250_center(row[0])
            out.append((lat, lon, int(v)))
        else:
            hidden += 1
    return out, hidden


def exposure(ix, iy, pop, radii=RADII):
    """ix,iy: 500mメッシュの格子番号（配列）。pop: [(lat, lon, 人口)]。戻り値 {R: 各メッシュの半径R km内の人口}。"""
    ix = np.asarray(ix); iy = np.asarray(iy)
    pad = int(max(radii) / (KM_DEG / 240) + 3)
    x0, y0 = ix.min() - pad, iy.min() - pad
    W, H = ix.max() - ix.min() + 2 * pad + 1, iy.max() - iy.min() + 2 * pad + 1
    g = np.zeros((H, W))
    for lat, lon, v in pop:
        gx, gy = math.floor(lon * 160) - x0, math.floor(lat * 240) - y0
        if 0 <= gx < W and 0 <= gy < H:
            g[gy, gx] += v
    dx, dy = KM_DEG * COS_REF / 160, KM_DEG / 240
    out = {}
    for R in radii:
        a, b = int(R / dx) + 1, int(R / dy) + 1
        yy, xx = np.mgrid[-b:b + 1, -a:a + 1]
        k = ((xx * dx) ** 2 + (yy * dy) ** 2 <= R * R).astype(float)
        c = fftconvolve(g, k, mode='same')
        out[R] = np.maximum(c[iy - y0, ix - x0], 0)
    return out


def main(work):
    os.makedirs(work, exist_ok=True)
    ix, iy = load_cells()
    pop, hidden, used = [], 0, []
    for p in range(51, 57):
        for u in range(38, 42):
            code = '%d%d' % (p, u)
            path = fetch(code, work)
            if path is None:
                continue
            cells, h = read_mesh(path)
            pop += cells; hidden += h; used.append(code)
            print(code, len(cells), 'cells', flush=True)
    total = sum(c[2] for c in pop)
    print('1次メッシュ', len(used), '人口合計', total, '秘匿セル', hidden)
    ex = exposure(ix, iy, pop)
    data = {
        'meta': {
            'source': 'e-Stat 地域メッシュ統計 令和2年国勢調査 250mメッシュ（統計表ID T001102）人口総数',
            'url': 'https://www.e-stat.go.jp/gis/statmap-search?type=1',
            'fetched': time.strftime('%Y-%m-%d'), 'firstMeshes': used, 'popTotal': total, 'hiddenCells': hidden, 'unit': UNIT,
            'method': '半径R km の円板（500mメッシュ中心どうしの距離）内の人口。緯度36度のcosで補正した平面近似', 'n': len(ix), 'radii': list(RADII),
        },
        'x': {str(R): [int(round(v / UNIT)) for v in ex[R]] for R in RADII},
    }
    out = os.path.join(ROOT, 'data', 'pop.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('// tools/kanto_pop.py が生成。e-Stat 地域メッシュ統計（令和2年国勢調査 250mメッシュ T001102）を500mメッシュごとの半径内人口に集計した実データ。手で編集しない。単位は100人。\n')
        f.write('window.SUGI_POP = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote', out, os.path.getsize(out) / 1e6, 'MB')


if __name__ == '__main__':
    main(sys.argv[1])
