"""子連れ向けの到達計算（前方探索 Connection Scan。乗車回数の上限つき）。

問い: 「その時刻に出発点を出て、徒歩→公共交通（乗継可）→徒歩で、到着点へ何分で着くか」。
行き（家→行き先、午前出発）も、帰り（行き先→家、夕方出発）も、同じ前方探索で求める（出発点が違うだけ）。
- 徒歩は直線距離×DETOUR を WALK_M_PER_MIN で歩くとして概算（道路網・坂・段差・横断は未考慮）。
- 1回の徒歩（出発点→最初の停留所、最後の停留所→到着点）は直線 cap_m 以内。徒歩だけで着く場合も cap_m 以内に限る。
- 乗継は同一の停留所群の中で TRANSFER_S 以上の余裕が要る。出発点から最初の乗車には余裕を取らない。
- 乗車回数の層: a1=1回だけ（乗換0回）, a2=2回まで（乗換1回まで）, a3=制限なし。
  層ごとに「その層以下の乗車回数で最も早い到着時刻」を持つ。
- 別の停留所群への徒歩乗換: 直線 WALK_TRANSFER_M 以内の別ノードへ、同じ徒歩モデルで歩いて乗り継げる
  （徒歩時間 + 乗継の余裕 TRANSFER_S 以上が要る）。浅草（銀座線・浅草線）・大手町・日比谷などの乗換を扱うため。
  徒歩乗換は、出発地から最初の停留所までの徒歩とは別の徒歩として扱う（上限 cap_m は掛けない）。
- 出発時刻は1点ではなく幅で見る: 時間帯の先頭から WINDOW_STEP_MIN 分おきに WINDOW_MIN 分後まで出発し、
  所要時間の中央値で判定する（5分ずれても結果が反転しにくい定義）。
便単位の時刻は結果に残さない（出力は所要時間を5分単位に丸めた値だけ）。
"""
import bisect
import math

from lifemap.access import Grid
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
WALK_TRANSFER_M = 300        # 別の停留所群へ歩いて乗り継げる直線距離の上限（徒歩乗換）
WINDOW_MIN = 30              # 出発時刻の幅（時間帯の先頭 h:00 から h:30 まで）
WINDOW_STEP_MIN = 5          # 幅の中で出発を試す間隔（5分おき → 7回）
INF = 10 ** 9


def walk_seconds(d_m):
    return d_m * DETOUR / (WALK_M_PER_MIN / 60.0)


def quant(minutes):
    """所要分 -> 5分刻みの符号 1..MAX_MIN/QUANT_MIN（切り上げ）。範囲外は 0。"""
    code = max(1, math.ceil(minutes / QUANT_MIN - 1e-9))
    return code if code <= MAX_MIN // QUANT_MIN else 0


class Router:
    """network: lifemap.network.Network（休日ダイヤ 'hol' の接続だけを使う）。"""

    def __init__(self, network, daytype="hol", transfer_s=TRANSFER_S, walk_transfer_m=WALK_TRANSFER_M):
        self.n = network.n
        self.transfer_s = transfer_s
        base = network.connections(daytype)       # 出発時刻の降順（後退走査用）
        self.conns = base[::-1]                   # 昇順（同時刻は便の前側が先）
        self.deps = [c[0] for c in self.conns]
        self.nodes = network.nodes
        self.walk_nb = [[] for _ in range(self.n)]   # ノード -> [(近くの別ノード, 徒歩秒)]
        if walk_transfer_m and self.n:
            g = Grid([(la, lo) for la, lo, _ in network.nodes])
            for i, (la, lo, _nm) in enumerate(network.nodes):
                for j, d in g.within(la, lo, walk_transfer_m):
                    if j != i:
                        self.walk_nb[i].append((j, walk_seconds(d)))

    def scan_full(self, sources, t0):
        """戻り値 (ready, alight): どちらも (層1, 層2, 層3) のノード別最早時刻（秒, 無ければ INF）。
        alight=その層以下の乗車回数で、車両で着いた最早時刻。ready=alight に「近くの別ノードへ歩いて着く」時刻を加えた、
        そのノードから乗り継げる時刻の基準（乗継には、さらに TRANSFER_S の余裕が要る）。"""
        n = self.n
        l1 = [INF] * n; l2 = [INF] * n; l3 = [INF] * n      # 車両で着いた時刻
        r1 = [INF] * n; r2 = [INF] * n; r3 = [INF] * n      # 乗り継げる基準の時刻（徒歩乗換を含む）
        tmax = t0 + MAX_MIN * 60
        T = self.transfer_s
        conns = self.conns
        nbs = self.walk_nb
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
                elif r1[u] + T <= dep:
                    nc = 2
                elif r3[u] + T <= dep:
                    nc = 3
                if nc < c:
                    c = nc
                    tk[trip] = c
                if c == 4:
                    continue
            if arr < l3[v]:
                l3[v] = arr
                if arr < r3[v]:
                    r3[v] = arr
                for w, ws in nbs[v]:
                    x = arr + ws
                    if x < r3[w]:
                        r3[w] = x
            if c <= 2 and arr < l2[v]:
                l2[v] = arr
                if arr < r2[v]:
                    r2[v] = arr
                for w, ws in nbs[v]:
                    x = arr + ws
                    if x < r2[w]:
                        r2[w] = x
            if c == 1 and arr < l1[v]:
                l1[v] = arr
                if arr < r1[v]:
                    r1[v] = arr
                for w, ws in nbs[v]:
                    x = arr + ws
                    if x < r1[w]:
                        r1[w] = x
        return (r1, r2, r3), (l1, l2, l3)

    def scan(self, sources, t0):
        """sources: {node: 出発点からの徒歩を終えた時刻(秒)}。戻り値 (a1, a2, a3): ノードごとに、その層の乗車回数で
        「着いている」最早時刻（車両で着く・車両で着いて近くの別ノードへ歩く。無ければ INF）。
        出発点にいるノードの近くの別ノードへも、出発点から歩けば着く（表示・検査用。乗り継ぎには使わない）。"""
        ready, _alight = self.scan_full(sources, t0)
        out = [list(a) for a in ready]
        for node, t in sources.items():
            for w, ws in self.walk_nb[node]:
                for a in out:
                    if t + ws < a[w]:
                        a[w] = t + ws
        return tuple(out)


def invert(points, node_grid, cap_m, owner=None):
    """points [(lat, lon)] -> {node: [(目的地の番号, 徒歩秒)]}（直線 cap_m 以内）。
    owner があれば、点 i は目的地 owner[i] の入口（1つの目的地が複数の点を持つ）で、目的地ごとに最短の徒歩秒だけ残す。"""
    inv = {}
    for i, (lat, lon) in enumerate(points):
        tid = i if owner is None else owner[i]
        for node, d in node_grid.within(lat, lon, cap_m):
            w = walk_seconds(d)
            lst = inv.setdefault(node, [])
            if owner is not None:
                for k, (t2, w2) in enumerate(lst):
                    if t2 == tid:
                        if w < w2:
                            lst[k] = (tid, w)
                        break
                else:
                    lst.append((tid, w))
            else:
                lst.append((tid, w))
    return inv


def source_map(point, node_grid, cap_m, t0):
    """point は (lat, lon)、または入口の点のリスト [(lat, lon), ...]（最も近い入口から歩く）。"""
    pts = [point] if isinstance(point[0], float) else point
    out = {}
    for lat, lon in pts:
        for node, d in node_grid.within(lat, lon, cap_m):
            t = t0 + walk_seconds(d)
            if t < out.get(node, INF):
                out[node] = t
    return out


def collect_minutes(labels, inv_targets, t0, n_targets, walk_only):
    """到着ノードのラベル（車両で着いた時刻）と、ノード→到着点の徒歩から、到着点ごと・層ごとの所要分（着けなければ INF）。

    walk_only: {到着点番号: 徒歩秒}（乗らずに歩いて着ける場合）。戻り値: 層 1,2,3 の所要分リスト（長さ n_targets）。"""
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
        durs = [INF] * n_targets
        for tid in range(n_targets):
            x = b[tid]
            dur = (x - t0) / 60.0 if x < INF else INF
            ws = walk_only.get(tid)
            if ws is not None:
                dur = min(dur, ws / 60.0)
            durs[tid] = dur
        out.append(durs)
    return out


def codes_from_minutes(durs):
    return [quant(x) if x <= MAX_MIN else 0 for x in durs]


def window_starts(hour, window_min=WINDOW_MIN, step_min=WINDOW_STEP_MIN):
    """出発時刻の幅 [hour:00, hour:00 + window_min] を step_min 分おきに区切った出発時刻（秒）。window_min=0 なら1点。"""
    base = int(round(hour * 3600))
    return [base + k * step_min * 60 for k in range(window_min // step_min + 1)]


def median_minutes(per_start):
    """出発時刻ごとの所要分（INF=着けない）のリスト -> 中央値（偶数個なら大きい方）。半分以上の出発で着けなければ INF。"""
    s = sorted(per_start)
    return s[len(s) // 2]


def collect(labels, inv_targets, t0, n_targets, walk_only):
    """collect_minutes を5分刻みの符号にしたもの（出発時刻1点の判定）。戻り値: 層 1,2,3 の符号リスト（0=着けない）。"""
    return [codes_from_minutes(d) for d in collect_minutes(labels, inv_targets, t0, n_targets, walk_only)]


def walk_pairs(a_points, b_points, cap_m, grid_cls, b_owner=None):
    """a の各点について、b の点のうち直線 cap_m 以内のものの徒歩秒 {a番号: {b番号: 秒}}。
    b_owner があれば b の点 j は目的地 b_owner[j] の入口で、目的地ごとに最短の徒歩秒を返す。"""
    g = grid_cls(b_points)
    out = {}
    for i, (lat, lon) in enumerate(a_points):
        near = {}
        for j, d in g.within(lat, lon, cap_m):
            tid = j if b_owner is None else b_owner[j]
            w = walk_seconds(d)
            if w < near.get(tid, INF):
                near[tid] = w
        if near:
            out[i] = near
    return out


__all__ = ["Router", "invert", "source_map", "collect", "collect_minutes", "walk_pairs", "dist_m"]
