"""ビルド時のデータ取得（GETのみ）。

キーが要るのは ODPTセンターの認証API（公共交通オープンデータ基本ライセンスのデータ）だけ。トークンは環境変数
ODPT_ACCESS_TOKEN から読み、取得時のURLにだけ付ける（cache/ のファイル名・ログ・例外には出さない）。

取得物は cache/ に保存する（gitignore 対象）。
- GTFSデータリポジトリ: feeds 一覧と各 feed.zip
- 国土数値情報: 医療機関(P04-20)・学校(P29-21)の都道府県別 zip
- 公共交通オープンデータセンター(ODPT): /files/ 配下にある事業者GTFS（公開API＝キー不要、認証API＝トークン必須）
- 国土数値情報 鉄道データ(N02-22): 駅（全国1ファイル）。GTFSに無い鉄道の駅の位置に使う
- e-Stat 統計GIS: 2020年国勢調査 地域メッシュ統計(T001102)の1次メッシュ別 zip
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

from . import odpt_adapter

FEEDS_URL = "https://api.gtfs-data.jp/v2/feeds"
FEED_ZIP_URL = "https://api.gtfs-data.jp/v2/organizations/{org}/feeds/{feed}/files/feed.zip"
P04_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P04/P04-20/P04-20_{pref}_GML.zip"
P29_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P29/P29-21/P29-21_{pref}_GML.zip"
MESH_URL = "https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T001102&code={code}&downloadType=2"
N02_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-22/N02-22_GML.zip"
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
    # URL と例外文にアクセストークンが含まれうるので伏せる。元の例外は連鎖させない（トレースバックに出さない）
    raise RuntimeError(odpt_adapter.redact(f"取得失敗: {url}: {last}")) from None


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


def feed_key(f):
    """regions.json の feeds の1要素 -> フィード識別キー。GTFSデータリポジトリ=(組織ID, フィードID)、ODPT=("odpt", id)。"""
    if isinstance(f, dict):
        return ("odpt", f["id"])
    return tuple(f)


def warn(msg):
    print(f"警告: {odpt_adapter.redact(msg)}", file=sys.stderr)


def fetch_feed(f, cache: Path, refresh=False):
    """feeds の1要素を取得してキャッシュのパスを返す。トークン必須のフィードを取れないときは警告して None。
    キャッシュのファイル名はフィードID（regions.json の id）だけから作り、トークンを含めない。"""
    key = feed_key(f)
    path = cache / "feed" / f"{key[0]}__{key[1]}.zip"
    if not isinstance(f, dict):
        return cached(path, FEED_ZIP_URL.format(org=key[0], feed=key[1]), refresh)
    if not odpt_adapter.needs_token(f):
        return cached(path, odpt_adapter.file_url(f["path"], query=f.get("query")), refresh)
    if not refresh and path.exists() and path.stat().st_size > 0:
        return path
    token = odpt_adapter.access_token()
    if not token:
        warn(f"{f.get('feed_name', key[1])}: 環境変数 {odpt_adapter.TOKEN_ENV} が無いので取得せずに飛ばします"
             "（ODPTセンターの開発者登録で得たアクセストークンが必要）。")
        return None
    try:
        return cached(path, odpt_adapter.file_url(f["path"], token=token, query=f.get("query")), refresh)
    except RuntimeError as e:
        warn(f"{f.get('feed_name', key[1])}: {e}。このフィードを飛ばします。")
        return None


def fetch_all(regions, cache: Path, refresh=False):
    feeds_json = cached(cache / "feeds.json", FEEDS_URL, refresh=True if refresh else False)
    paths = {"feeds_json": feeds_json, "feed": {}, "skipped": [], "p04": {}, "p29": {}, "mesh": {}, "rail": None}
    for reg in regions:
        for f in reg["feeds"]:
            got = fetch_feed(f, cache, refresh)
            if got is None:
                paths["skipped"].append(feed_key(f))
            else:
                paths["feed"][feed_key(f)] = got
        if reg.get("rail_covered") is not None:
            paths["rail"] = cached(cache / "ksj" / "N02-22.zip", N02_URL, refresh)
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
