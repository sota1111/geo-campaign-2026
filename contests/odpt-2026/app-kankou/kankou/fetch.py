"""ビルド時のデータ取得。GET のみ・アクセストークン不要の公開データだけを使う。

取得物は cache/ に保存する（コミットしない）。ODPT の認証API（api.odpt.org）とアクセストークンは使わない。
"""
import time
import urllib.request
from pathlib import Path

UA = {"User-Agent": "kankou-route-build/0.1 (static site preprocessing; GET only)"}
PUBLIC_HOSTS = ("https://api-public.odpt.org/", "https://api.gtfs-data.jp/", "https://nlftp.mlit.go.jp/")


def http_get(url, timeout=180, retries=3):
    if not url.startswith(PUBLIC_HOSTS):
        raise ValueError(f"トークン不要の公開データ以外は取得しない: {url}")
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + i)
    raise RuntimeError(f"取得失敗: {url}: {last}")


def cached(path, url, refresh=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists() or path.stat().st_size == 0:
        path.write_bytes(http_get(url))
    return path
