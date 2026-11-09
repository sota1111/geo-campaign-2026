"""公共交通オープンデータセンター(ODPT)のデータ取得。キー不要の公開API（api-public.odpt.org）を使う。

- 公開API: https://api-public.odpt.org/api/v4/  （例: odpt:Operator は認証なしで JSON を返す）
- 事業者提供のGTFS: /files/<事業者>/data/<ファイル名>.zip は 302 でストレージの短時間有効URLへ移るので、
  リダイレクトを辿って取得する（urllib は既定で辿る）。キー（consumer key）は使わず、コードにも含めない。
- 取得したGTFSは GTFSデータリポジトリと同じ GTFS(-JP) なので、`lifemap.gtfs.load_feed()` がそのまま読める。
  本モジュールは「どこから取るか」だけを担当し、Network 以降（統合・診断・出力）は共通。

regions.json の feeds には、次の形のオブジェクトで書く（GTFSデータリポジトリのものは ["組織ID", "フィードID"] のまま）:
    {"source": "odpt", "id": "toei-bus", "path": "Toei/data/ToeiBus-GTFS.zip",
     "organization_name": ..., "feed_name": ..., "feed_license": ..., "feed_license_url": ...,
     "credit": ..., "page_url": ..., "last_updated_at": ...}
"""
import json
import urllib.request

from .gtfs import load_feed

API_BASE = "https://api-public.odpt.org/api/v4"
UA = {"User-Agent": "life-access-map-build/1.0 (static site preprocessing)"}


def file_url(path):
    return f"{API_BASE}/files/{path}"


def operators(timeout=60):
    """odpt:Operator の一覧（接続確認と、事業者名の確認用）。"""
    req = urllib.request.Request(f"{API_BASE}/odpt:Operator", headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_odpt_feed(zip_path, bbox, today):
    """ODPTセンター提供のGTFS zip を読む（load_feed と同じ戻り値）。"""
    return load_feed(zip_path, bbox, today)
