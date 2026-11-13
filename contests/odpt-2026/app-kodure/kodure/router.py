"""子連れ向けの到達計算（前方探索 Connection Scan。乗車回数の上限つき）。

問い: 「その時刻に出発点を出て、徒歩→公共交通（乗継可）→徒歩で、到着点へ何分で着くか」。
行き（家→行き先、午前出発）も、帰り（行き先→家、夕方出発）も、同じ前方探索で求める（出発点が違うだけ）。
- 徒歩は直線距離×DETOUR を WALK_M_PER_MIN で歩くとして概算（道路網・坂・段差・横断は未考慮）。
- 1回の徒歩（出発点→最初の停留所、最後の停留所→到着点）は直線 cap_m 以内。徒歩だけで着く場合も cap_m 以内に限る。
- 乗継は同一の停留所群の中で TRANSFER_S 以上の余裕が要る。出発点から最初の乗車には余裕を取らない。
- 乗車回数の層: a1=1回だけ（乗換0回）, a2=2回まで（乗換1回まで）, a3=制限なし。
  層ごとに「その層以下の乗車回数で最も早い到着時刻」を持つ。
便単位の時刻は結果に残さない（出力は所要時間を5分単位に丸めた値だけ）。
"""
import bisect
import math

from lifemap.network import dist_m

WALK_M_PER_MIN = 60.0        # 仮定: ベビーカー連れの徒歩。根拠となる調査値は確認していない（README参照）
DETOUR = 1.25                # 直線距離に対する道のりの倍率（既存アプリと同じ概算）
TRANSFER_S = 300             # 仮定: ベビーカーで乗り換える余裕（既存アプリは3分）
CAPS_M = (300, 500, 800)     # 1回の徒歩の直線距離の上限（選択肢）
OUT_HOURS = (9, 10)          # 行きの出発時刻（時）
RET_HOURS = (16, 17)         # 帰りの出発時刻（時）
MAX_MIN = 90                 # これ以内に着くものだけ記録
QUANT_MIN = 5                # 所要時間を5分刻み（切り上げ）で記録
LAYERS = (1, 2, 3)           # 乗車回数の層（1=乗換0回, 2=乗換1回まで, 3=制限なし）
INF = 10 ** 9


def walk_seconds(d_m):
    return d_m * DETOUR / (WALK_M_PER_MIN / 60.0)


def quant(minutes):
    """所要分 -> 5分刻みの符号 1..MAX_MIN/QUANT_MIN（切り上げ）。範囲外は 0。"""
    code = max(1, math.ceil(minutes / QUANT_MIN - 1e-9))
    return code if code <= MAX_MIN // QUANT_MIN else 0


class Router:
    """network: lifemap.network.Network（休日ダイヤ 'hol' の接続だけを使う）。"""

    def __init__(self, network, daytype="hol", transfer_s=TRANSFER_S):
        self.n = network.n
        self.transfer_s = transfer_s
        base = network.connections(daytype)       # 出発時刻の降順（後退走査用）
        self.conns = base[::-1]                   # 昇順（同時刻は便の前側が先）
        self.deps = [c[0] for c in self.conns]
        self.nodes = network.nodes

    def scan(self, sources, t0):
        """sources: {node: 出発点からの徒歩を終えた時刻(秒)}。戻り値 (a1, a2, a3): ノードごとの最早到着時刻（秒, 無ければ INF）。"""
        n = self.n
        a1 = [INF] * n
        a2 = [INF] * n
        a3 = [INF] * n
        tmax = t0 + MAX_MIN * 60
        T = self.transfer_s
        conns = self.conns
        tk = {}
        src_get = sources.get
        for k in range(bisect.bisect_left(self.deps, t0), len(conns)):
            dep, arr, u, v, trip = conns[k]
            if dep > tmax:
                break
            c = tk.get(trip, 4)
            if c > 1:
                nc = 4
                if src_get(u, INF) <= dep:
                    nc = 1
                elif a1[u] + T <= dep:
                    nc = 2
                elif a3[u] + T <= dep:
                    nc = 3
                if nc < c:
                    c = nc
                    tk[trip] = c
                if c == 4:
                    continue
            if arr < a3[v]:
                a3[v] = arr
            if c <= 2 and arr < a2[v]:
                a2[v] = arr
            if c == 1 and arr < a1[v]:
                a1[v] = arr
        return a1, a2, a3


def invert(points, node_grid, cap_m):
    """points [(lat, lon)] -> {node: [(点の番号, 徒歩秒)]}（直線 cap_m 以内）。"""
    inv = {}
    for i, (lat, lon) in enumerate(points):
        for node, d in node_grid.within(lat, lon, cap_m):
            inv.setdefault(node, []).append((i, walk_seconds(d)))
    return inv


def source_map(point, node_grid, cap_m, t0):
    lat, lon = point
    return {node: t0 + walk_seconds(d) for node, d in node_grid.within(lat, lon, cap_m)}


def collect(labels, inv_targets, t0, n_targets, walk_only):
    """到着ノードのラベルと、ノード→到着点の徒歩から、到着点ごと・層ごとの所要時間の符号を求める。

    walk_only: {到着点番号: 徒歩秒}（乗らずに歩いて着ける場合）。戻り値: 層 1,2,3 の符号リスト（長さ n_targets, 0=着けない）。
    """
    best = [[INF] * n_targets for _ in LAYERS]
    for li, a in enumerate(labels):
        b = best[li]
        for node, lst in inv_targets.items():
            t = a[node]
            if t >= INF:
                continue
            for tid, w in lst:
                x = t + w
                if x < b[tid]:
                    b[tid] = x
    out = []
    for li in range(len(LAYERS)):
        b = best[li]
        codes = [0] * n_targets
        for tid in range(n_targets):
            x = b[tid]
            ws = walk_only.get(tid)
            dur = (x - t0) / 60.0 if x < INF else INF
            if ws is not None:
                dur = min(dur, ws / 60.0)
            if dur <= MAX_MIN:
                codes[tid] = quant(dur)
        out.append(codes)
    return out


def walk_pairs(a_points, b_points, cap_m, grid_cls):
    """a の各点について、b の点のうち直線 cap_m 以内のものの徒歩秒 {a番号: {b番号: 秒}}。"""
    g = grid_cls(b_points)
    out = {}
    for i, (lat, lon) in enumerate(a_points):
        near = {j: walk_seconds(d) for j, d in g.within(lat, lon, cap_m)}
        if near:
            out[i] = near
    return out


__all__ = ["Router", "invert", "source_map", "collect", "walk_pairs", "dist_m"]
