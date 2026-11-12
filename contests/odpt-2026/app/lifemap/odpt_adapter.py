"""公共交通オープンデータセンター(ODPT)のデータ取得。

- 公開API（キー不要）: https://api-public.odpt.org/api/v4/  CC BY 4.0 等のデータ（都営バス・都営地下鉄など）
- 認証API（アクセストークン必須）: https://api.odpt.org/api/v4/  公共交通オープンデータ基本ライセンスのデータ
  （東京メトロ・東京臨海高速鉄道・つくばエクスプレス・関東バスなど）。トークンは環境変数 ODPT_ACCESS_TOKEN から
  取得時だけ URL のクエリ（acl:consumerKey）に付ける。コード・cache/ のファイル名・web/data・ログ・例外メッセージには
  出さない（例外時は redact() で伏せる）。トークンが無い環境では、キャッシュが無ければそのフィードを警告して飛ばす。
- 事業者提供のGTFS: /files/<事業者>/data/<ファイル名>.zip は 302 でストレージの短時間有効URLへ移るので、
  リダイレクトを辿って取得する（urllib は既定で辿る）。
- 取得したGTFSは GTFSデータリポジトリと同じ GTFS(-JP) なので、`lifemap.gtfs.load_feed()` がそのまま読める。
  本モジュールは「どこから取るか」だけを担当し、Network 以降（統合・診断・出力）は共通。

regions.json の feeds には、次の形のオブジェクトで書く（GTFSデータリポジトリのものは ["組織ID", "フィードID"] のまま）:
    {"source": "odpt", "id": "toei-bus", "path": "Toei/data/ToeiBus-GTFS.zip",
     "organization_name": ..., "feed_name": ..., "feed_license": ..., "feed_license_url": ...,
     "credit": ..., "page_url": ..., "last_updated_at": ...}
認証APIのものは "auth": "token" を付ける。版を日付で選ぶフィードは "query": {"date": "YYYYMMDD"} を付ける。
鉄道のフィードは "rail_covered": [["運営会社(国土数値情報N02の表記)", 路線名 or null], ...] を付けると、
そのフィードを読み込めたときだけ、その鉄道を「GTFS未収録の鉄道」から外す。
"""
import json
import os
import re
import urllib.parse
import urllib.request

from .gtfs import load_feed

API_BASE = "https://api-public.odpt.org/api/v4"
API_BASE_TOKEN = "https://api.odpt.org/api/v4"
TOKEN_ENV = "ODPT_ACCESS_TOKEN"
UA = {"User-Agent": "life-access-map-build/1.0 (static site preprocessing)"}
_KEY_RE = re.compile(r"(acl(?::|%3A)consumerKey=)[^&\s'\"]+", re.I)


def needs_token(f):
    """regions.json の feeds の1要素が、認証API（アクセストークン必須）のものか。"""
    return isinstance(f, dict) and f.get("auth") == "token"


def access_token():
    """環境変数のアクセストークン（無ければ None）。値は返すだけで、表示・保存しない。"""
    return (os.environ.get(TOKEN_ENV) or "").strip() or None


def file_url(path, token=None, query=None):
    """/files/ 配下のURL。token を渡すと認証API（api.odpt.org）に acl:consumerKey を付けたURL、無ければ公開API。"""
    q = dict(query or {})
    base = API_BASE
    if token:
        base = API_BASE_TOKEN
        q["acl:consumerKey"] = token
    url = f"{base}/files/{path}"
    if q:
        url += "?" + urllib.parse.urlencode(q, safe=":")
    return url


def redact(text, token=None):
    """文字列中のアクセストークンを伏せる（URLの acl:consumerKey=... と、トークンそのもの）。"""
    s = _KEY_RE.sub(r"\1***", str(text))
    tok = token if token is not None else access_token()
    if tok:
        s = s.replace(tok, "***")
    return s


def operators(timeout=60):
    """odpt:Operator の一覧（接続確認と、事業者名の確認用）。"""
    req = urllib.request.Request(f"{API_BASE}/odpt:Operator", headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_odpt_feed(zip_path, bbox, today):
    """ODPTセンター提供のGTFS zip を読む（load_feed と同じ戻り値）。"""
    return load_feed(zip_path, bbox, today)
