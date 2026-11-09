"""拡張点: 公共交通オープンデータセンター(ODPT)の事業者データを追加するための差し込み口。

現状（キー未取得）は未実装。本アプリはGTFSデータリポジトリだけで動く。

ODPTセンターのAPIキーを取得できた場合は、ここで ODPT(JSON)または事業者提供のGTFSを読み込み、
`lifemap.gtfs.load_feed()` と同じ形の dict を返す関数を実装し、`lifemap/build.py` の
feeds 読み込み部分から呼ぶ。Network 以降（統合・診断・出力）は変更不要。

戻り値の形（load_feed と同じ）:
    {
      "stops":  {stop_id: (lat, lon, name)},
      "routes": {route_id: (short_name, long_name, color)},
      "trips":  [{"trip_id", "route_id", "dir", "active": {"wd": bool, "hol": bool},
                  "seq": [(stop_id, 到着秒, 出発秒), ...]}],
      "ref":    {"wd": date, "hol": date},     # 平日・休日の基準日
      "start":  date | None, "end": date | None,
    }

キーはコードやリポジトリに含めず、環境変数(例: ODPT_CONSUMER_KEY)から読むこと。
"""


def load_odpt_feed(*args, **kwargs):
    raise NotImplementedError("ODPTセンターAPIは未対応です（キー未取得）。このファイルのdocstringを参照。")
