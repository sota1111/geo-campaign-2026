#!/usr/bin/env python3
"""全国の人口（令和2年国勢調査 地域メッシュ統計 1kmメッシュ、e-Stat 統計表ID T001101、人口総数 T001101001）を GET で取得する。
  https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001101&code=<1次メッシュ>&downloadType=2
1次メッシュ（緯度 30〜68 × 経度 22〜54 の範囲）を総当たりで要求し、存在しないもの（404）は飛ばす。取得した zip は作業ディレクトリに保存して再利用する。
出力: <作業>/pop1km.json  [[lat, lon, 人口], ...]（1kmメッシュの中心点。人口総数の列が数字のセルのみ。'*' は数えず件数を stats に記録）
使い方: python3 -I tools/national_pop.py <作業ディレクトリ>
出典: 総務省統計局 政府統計の総合窓口（e-Stat）地域メッシュ統計 令和2年国勢調査。市町村への割り当ては national_build.py（1kmメッシュの中心点が入る市町村。概数）。
"""
import concurrent.futures as cf, csv, io, json, os, sys, time, urllib.error, urllib.request, zipfile

URL = 'https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001101&code=%s&downloadType=2'


def fetch(code, work):
    p = os.path.join(work, 'z', 'm%s.zip' % code)
    if os.path.exists(p):
        return code, p
    if os.path.exists(p + '.none'):
        return code, None
    for k in range(5):
        try:
            req = urllib.request.Request(URL % code, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            open(p, 'wb').write(data)
            return code, p
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                open(p + '.none', 'w').close()
                return code, None
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(3 * (k + 1))
    raise RuntimeError('取得できない: ' + code)


def center(code):
    """8桁の地域メッシュコード（3次メッシュ=1km）の中心 (lat, lon)。"""
    p, u, q, v, r, w = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7])
    lat = p * 40 / 60 + q * 5 / 60 + r * 30 / 3600 + 15 / 3600
    lon = 100 + u + v * 7.5 / 60 + w * 45 / 3600 + 22.5 / 3600
    return lat, lon


def read(path):
    z = zipfile.ZipFile(path)
    rd = csv.reader(io.StringIO(z.read(z.namelist()[0]).decode('cp932')))
    next(rd); next(rd)
    out, hidden = [], 0
    for row in rd:
        v = row[4].strip()
        if v.isdigit():
            lat, lon = center(row[0])
            out.append([round(lat, 5), round(lon, 5), int(v)])
        else:
            hidden += 1
    return out, hidden


def main(work):
    os.makedirs(os.path.join(work, 'z'), exist_ok=True)
    codes = ['%d%02d' % (p, u) for p in range(30, 69) for u in range(22, 55)]
    got = []
    with cf.ThreadPoolExecutor(8) as ex:
        for code, p in ex.map(lambda c: fetch(c, work), codes):
            if p:
                got.append(p)
    pts, hid = [], 0
    for p in sorted(got):
        o, h = read(p)
        pts += o; hid += h
    json.dump(pts, open(os.path.join(work, 'pop1km.json'), 'w'))
    print('1次メッシュ', len(got), '面、1kmメッシュ', len(pts), '個、人口合計', sum(p[2] for p in pts), '、総数が数字でない行', hid)


if __name__ == '__main__':
    main(sys.argv[1])
