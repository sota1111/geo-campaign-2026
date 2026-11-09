"""ビルド時のデータ取得（GETのみ・キー不要）。

取得物は cache/ に保存する（gitignore 対象）。
- GTFSデータリポジトリ: feeds 一覧と各 feed.zip
- 国土数値情報: 医療機関(P04-20)・学校(P29-21)の都道府県別 zip
- e-Stat 統計GIS: 2020年国勢調査 地域メッシュ統計(T001102)の1次メッシュ別 zip
"""
import json
import time
import urllib.request
from pathlib import Path

FEEDS_URL = "https://api.gtfs-data.jp/v2/feeds"
FEED_ZIP_URL = "https://api.gtfs-data.jp/v2/organizations/{org}/feeds/{feed}/files/feed.zip"
P04_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P04/P04-20/P04-20_{pref}_GML.zip"
P29_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P29/P29-21/P29-21_{pref}_GML.zip"
MESH_URL = "https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code={code}&downloadType=2"
UA = {"User-Agent": "life-access-map-build/1.0 (static site preprocessing)"}


def http_get(url, timeout=120, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - 再試行のため広く捕捉
            last = e
            time.sleep(1 + i)
    raise RuntimeError(f"取得失敗: {url}: {last}")


def cached(path: Path, url: str, refresh=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists() or path.stat().st_size == 0:
        path.write_bytes(http_get(url))
    return path


def primary_mesh_codes(bbox):
    """bbox=[lon_min, lat_min, lon_max, lat_max] を覆う1次メッシュコード(4桁)の一覧。"""
    lo, la, hi_lo, hi_la = bbox
    codes = []
    for p in range(int(la * 1.5), int(hi_la * 1.5) + 1):
        for q in range(int(lo) - 100, int(hi_lo) - 100 + 1):
            codes.append(f"{p:02d}{q:02d}")
    return codes


def fetch_all(regions, cache: Path, refresh=False):
    feeds_json = cached(cache / "feeds.json", FEEDS_URL, refresh=True if refresh else False)
    paths = {"feeds_json": feeds_json, "feed": {}, "p04": {}, "p29": {}, "mesh": {}}
    for reg in regions:
        for org, feed in reg["feeds"]:
            p = cached(cache / "feed" / f"{org}__{feed}.zip", FEED_ZIP_URL.format(org=org, feed=feed), refresh)
            paths["feed"][(org, feed)] = p
        pref = reg["pref"]
        paths["p04"][pref] = cached(cache / "ksj" / f"P04-20_{pref}.zip", P04_URL.format(pref=pref), refresh)
        paths["p29"][pref] = cached(cache / "ksj" / f"P29-21_{pref}.zip", P29_URL.format(pref=pref), refresh)
        for code in primary_mesh_codes(reg["bbox"]):
            paths["mesh"][code] = cached(cache / "mesh" / f"T001102_{code}.zip", MESH_URL.format(code=code), refresh)
    return paths


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    regs = json.loads((root / "regions.json").read_text(encoding="utf-8"))["regions"]
    out = fetch_all(regs, root / "cache")
    print("feeds", len(out["feed"]), "mesh", sorted(out["mesh"]))
