"""国土数値情報 A54（大規模盛土造成地 2023）の静岡県分を GET でダウンロードして展開する。
使い方: python3 -I tools/fetch_raw.py <出力ディレクトリ>
POST は行わない。ライセンス: CC BY 4.0（国土交通省 国土数値情報）。
"""
import os
import sys
import urllib.request
import zipfile

URL = "https://nlftp.mlit.go.jp/ksj/gml/data/A54/A54-23/A54-23_22_GML.zip"

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
data = urllib.request.urlopen(req, timeout=120).read()
p = os.path.join(out, "a54_22.zip")
with open(p, "wb") as f:
    f.write(data)
z = zipfile.ZipFile(p)
print("\n".join(z.namelist()))
z.extractall(out)
