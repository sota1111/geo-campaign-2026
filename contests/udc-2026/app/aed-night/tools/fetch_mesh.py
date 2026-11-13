#!/usr/bin/env python3
"""e-Stat 統計GIS から地域メッシュ統計（1次メッシュ別 zip）を取得する（GETのみ）。

usage: python3 -I tools/fetch_mesh.py <statsId> <1次メッシュコード> <出力zip>
例: python3 -I tools/fetch_mesh.py T001141 5339 raw/T001141_5339.zip
"""
import sys
import urllib.request

URL = "https://www.e-stat.go.jp/gis/statmap-search/data?statsId={sid}&code={code}&downloadType=2"


def main():
    sid, code, out = sys.argv[1:4]
    req = urllib.request.Request(URL.format(sid=sid, code=code),
                                 headers={"User-Agent": "udc2026-aed-night/0.1 (GET only)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if data[:2] != b"PK":
        raise SystemExit("zip ではない応答: " + data[:80].decode("utf-8", "ignore"))
    open(out, "wb").write(data)
    print(out, len(data), "bytes")


if __name__ == "__main__":
    main()
