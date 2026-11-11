"""実データの取得（GET のみ。APIキー不要）。
- 国土数値情報 A54 大規模盛土造成地（2023年版）神奈川県分。CC BY 4.0（国土交通省）
- 国土数値情報 A56 宅地造成等工事規制区域・特定盛土等規制区域（2025年版、基準日 2025-07-18）神奈川県分。CC BY 4.0（国土交通省）
使い方: python3 -I tools/fetch_raw.py <出力ディレクトリ>
"""
import os
import sys
import urllib.request
import zipfile

URLS = [
    "https://nlftp.mlit.go.jp/ksj/gml/data/A54/A54-23/A54-23_14_GML.zip",
    "https://nlftp.mlit.go.jp/ksj/gml/data/A56/A56-25/A56-25_14_GML.zip",
]
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for url in URLS:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=180).read()
    name = url.rsplit("/", 1)[1]
    p = os.path.join(out, name)
    with open(p, "wb") as f:
        f.write(data)
    z = zipfile.ZipFile(p)
    z.extractall(os.path.join(out, name[:-4]))
    print(name, len(data), "bytes;", len(z.namelist()), "files")
