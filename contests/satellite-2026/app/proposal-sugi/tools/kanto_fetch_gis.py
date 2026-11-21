#!/usr/bin/env python3
"""国土数値情報の2種類のデータを GET で取得して展開する（ログイン・POST なし）。
  行政区域 N03（2025年版、CC BY 4.0）: RAW/n03/<都県コード 08〜14>/
  標高・傾斜度5次メッシュ G04-d（2011年度版、商用可、出典に国土地理院の承認表示が必要）: RAW/g04/<1次メッシュ>/
G04-d の1次メッシュは関東1都6県（島しょを除く）をおおう 5238,5239,5240,5338,5339,5340,5438,5439,5440,5538,5539,5540。
使い方: python3 -I tools/kanto_fetch_gis.py <RAW>
"""
import io, os, sys, urllib.request, zipfile

N03 = 'https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_%s_GML.zip'
G04 = 'https://nlftp.mlit.go.jp/ksj/gml/data/G04-d/G04-d-11/G04-d-11_%s-jgd_GML.zip'
MESH = ['5238', '5239', '5240', '5338', '5339', '5340', '5438', '5439', '5440', '5538', '5539', '5540']


def fetch(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=300).read())) as z:
        os.makedirs(dest, exist_ok=True)
        z.extractall(dest)


def main(raw):
    for p in ['08', '09', '10', '11', '12', '13', '14']:
        fetch(N03 % p, os.path.join(raw, 'n03', p)); print('n03', p, flush=True)
    for m in MESH:
        fetch(G04 % m, os.path.join(raw, 'g04', m)); print('g04', m, flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
