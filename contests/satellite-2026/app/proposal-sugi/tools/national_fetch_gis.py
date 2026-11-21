#!/usr/bin/env python3
"""国土数値情報 行政区域 N03（2025年版、CC BY 4.0）を47都道府県ぶん GET で取得して展開する（ログイン・POST なし）。
使い方: python3 -I tools/national_fetch_gis.py <作業ディレクトリ>   → <作業>/n03/<都道府県コード>/
出典: 国土交通省 国土数値情報 行政区域データ N03-20250101 https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html
"""
import io, os, sys, time, urllib.request, zipfile

N03 = 'https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_%02d_GML.zip'


def fetch(url, dest):
    for k in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=300).read())) as z:
                os.makedirs(dest, exist_ok=True)
                z.extractall(dest)
            return
        except Exception as e:
            print('retry', url, k, e, flush=True)
            time.sleep(10 * (k + 1))
    raise SystemExit('取得に失敗: ' + url)


def main(work):
    for p in range(1, 48):
        d = os.path.join(work, 'n03', '%02d' % p)
        if not os.path.isdir(d):
            fetch(N03 % p, d)
        print('n03', p, flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
