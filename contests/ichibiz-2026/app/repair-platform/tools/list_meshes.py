"""PLATEAU 東京23区 CityGML の建築物ファイル（bldg）の一覧を出す。使い方: python3 -I tools/list_meshes.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from remotezip import open_zip  # noqa: E402

z = open_zip()
b = [i for i in z.infolist() if "/bldg/" in i.filename and i.filename.endswith(".gml")]
print(len(b), "files", round(sum(i.file_size for i in b) / 1e9, 2), "GB (展開後)")
for i in b[:6]:
    print(i.filename, i.file_size)
