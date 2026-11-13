"""テスト用の共通部品: 既存アプリのテスト部品（合成GTFS）と、乗車回数つき探索の独立した参照実装。"""
import datetime as dt
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT.parent / "app"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(APP) not in sys.path:
    sys.path.append(str(APP))   # 末尾に足す（app/tests が自分の tests より先に見つからないように）

import kodure  # noqa: E402,F401  既存アプリの lifemap を import できるようにする
from lifemap import gtfs  # noqa: E402
from lifemap.network import Network  # noqa: E402

# 既存アプリのテスト部品（合成GTFSの作成）。tests ディレクトリを sys.path に入れると同名のテストモジュールと衝突するので、ファイルから直接読む
_spec = importlib.util.spec_from_file_location("odpt_app_test_helpers", APP / "tests" / "helpers.py")
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
make_feed_zip = _helpers.make_feed_zip

BBOX = [139.0, 35.0, 140.0, 36.0]


def make_network(stops, trips, routes=(("r1", "1", "A線"),)):
    """stops [(id, name, lat, lon)], trips [(trip_id, route_id, service_id, dir, [(stop_id, 'H:MM:SS', 'H:MM:SS')])]
    日曜（'ho'）に運行する便だけを持つ Network（休日ダイヤ hol だけを使う）。基準日は 2026-11-15（日曜）。"""
    cal = [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"), ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]
    z = make_feed_zip(stops, list(routes), trips, cal, feed_info=("20261101", "20271031"))
    fd = gtfs.load_feed(z, BBOX, dt.date(2026, 11, 14))
    return Network([fd], [("t", "f")])


def reference_rounds(trips, n_nodes, sources, t0, transfer_s, tmax, max_rounds=30):
    """乗車回数ごとのラウンドで最早到着を求める独立実装（RAPTOR 風）。
    trips: [[(node, arr, dep), ...]]。sources {node: 徒歩を終えた時刻}。
    戻り値 (L1, L2, L3): 乗車1回だけ / 2回まで / 制限なしの、ノードごとの最早到着（無ければ inf）。"""
    inf = float("inf")
    prev = [inf] * n_nodes   # 直前のラウンドまでの（k-1回以下の）最早到着
    best_le = []
    cur_le = [inf] * n_nodes
    for k in range(1, max_rounds + 1):
        arr_k = [inf] * n_nodes
        for seq in trips:
            boarded = False
            for i in range(len(seq) - 1):
                node, _a, dep = seq[i]
                if not boarded and dep <= tmax:
                    ready = sources.get(node, inf) if k == 1 else prev[node] + transfer_s
                    if k > 1:
                        ready = min(ready, inf)
                    if dep >= t0 and ready <= dep:
                        boarded = True
                if boarded and dep <= tmax:
                    nxt = seq[i + 1]
                    if nxt[1] < arr_k[nxt[0]]:
                        arr_k[nxt[0]] = nxt[1]
        new = [min(cur_le[v], arr_k[v]) for v in range(n_nodes)]
        best_le.append(new)
        prev = new
        cur_le = new
    return best_le[0], best_le[1], best_le[-1]
