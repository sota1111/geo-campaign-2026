#!/usr/bin/env python3
"""BODIK ODM（CKAN API、GETのみ）でタイトルに AED を含む CSV 資料を一覧し、
自治体標準オープンデータセット形式（ヘッダーに「利用可能曜日」）のものだけを抜き出す。

usage: python3 -I tools/discover_bodik.py <出力JSON> [<作業ディレクトリ>]
標準形式かどうかは CSV の先頭 4KB を見て判定する（全件は保存しない）。
"""
import json
import sys
import urllib.parse
import urllib.request

API = "https://odm.bodik.jp/api/3/action/package_search"
UA = {"User-Agent": "udc2026-aed-night/0.1 (research; GET only)"}


def get(url, n=None, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(n) if n else r.read()


def main():
    out = sys.argv[1]
    found = []
    seen = set()
    for start in range(0, 700, 100):
        q = urllib.parse.urlencode({"q": "title:AED", "rows": 100, "start": start})
        d = json.loads(get(f"{API}?{q}"))
        for p in d["result"]["results"]:
            for r in p["resources"]:
                if r["format"].upper() != "CSV" or r["url"] in seen:
                    continue
                seen.add(r["url"])
                found.append({"org": p["organization"]["title"], "title": p["title"],
                              "license": p["license_title"], "url": r["url"], "pkg": p["name"],
                              "modified": p["metadata_modified"]})
    print("CSV資料", len(found))
    std = []
    for f in found:
        try:
            head = get(f["url"], 4096, timeout=20)
        except Exception as e:  # 取得できないものは対象外
            f["err"] = str(e)[:80]
            continue
        txt = head.decode("utf-8-sig", errors="ignore")
        if "利用可能曜日" in txt.split("\n")[0]:
            std.append(f)
    print("標準形式（利用可能曜日あり）", len(std))
    for f in std:
        print(f["org"], "|", f["title"], "|", f["license"], "|", f["url"])
    json.dump(std, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
