"""到達診断のコア（後退走査 Connection Scan）。

問い: 「その時刻に出発して、W分以内に、公共交通で施設に着けるか」
  家 --徒歩--> 停留所 --乗車(同一地点での乗継可)--> 停留所 --徒歩--> 施設
W は THRESHOLDS（分）。時刻の待ち時間・乗継の待ち時間は W に含む。
徒歩は直線距離 × DETOUR を WALK_MPS で歩くものとして概算する（道路網は使わない）。
"""
import math

from .network import dist_m

WALK_MPS = 80.0 / 60.0      # 80 m/分
DETOUR = 1.25              # 直線距離に対する迂回率
MAX_WALK_IN_M = 600        # 出発地(メッシュ中心)から乗車停留所まで（直線）
MAX_WALK_OUT_M = 500       # 降車停留所から施設まで（直線）
WALK_ONLY_M = 800          # 施設が直線でこの距離以内なら「徒歩圏」
TRANSFER_S = 180           # 乗継に必要な最小時間（秒）
THRESHOLDS = (20, 30, 45, 60)   # 分。小さい方が良い
START_HOURS = {"m": 8, "d": 12, "e": 17}   # 出発時刻（時）
PERIODS = ("m", "d", "e")
NEG = -10 ** 9


def walk_seconds(d_m):
    return d_m * DETOUR / WALK_MPS


class Grid:
    """点の格子索引（半径検索用）。"""

    def __init__(self, points, cell=0.003):
        self.cell = cell
        self.points = points
        self.g = {}
        for i, (lat, lon) in enumerate(points):
            self.g.setdefault((int(lat / cell), int(lon / cell)), []).append(i)

    def within(self, lat, lon, radius_m):
        r_lat = radius_m / 110574.0 / self.cell
        r_lon = radius_m / (111320.0 * math.cos(math.radians(lat))) / self.cell
        gy, gx = int(lat / self.cell), int(lon / self.cell)
        out = []
        for dy in range(-int(r_lat) - 1, int(r_lat) + 2):
            for dx in range(-int(r_lon) - 1, int(r_lon) + 2):
                for i in self.g.get((gy + dy, gx + dx), ()):
                    d = dist_m(lat, lon, *self.points[i])
                    if d <= radius_m:
                        out.append((i, d))
        return out


def latest_departures(conns, n_nodes, final_deadline, transfer_s=TRANSFER_S):
    """後退走査。final_deadline {node: 秒} に到達すれば良いとして、各ノードの最遅出発時刻を返す。

    ld[u] = u を出発できる最も遅い時刻（これ以前に着けば間に合う）。到達不能は NEG。
    """
    ld = [NEG] * n_nodes
    trip_ok = set()
    get = final_deadline.get
    for dep, arr, u, v, trip in conns:
        fd = get(v)
        if trip in trip_ok or (fd is not None and arr <= fd) or arr + transfer_s <= ld[v]:
            trip_ok.add(trip)
            if dep > ld[u]:
                ld[u] = dep
    return ld


def level_for(ld_by_threshold, candidates, t0):
    """candidates [(node, walk_in_s)]。最小の W を満たす水準 (1..len(THRESHOLDS)) を返す。0 は到達不能。

    ld_by_threshold: THRESHOLDS と同順の ld 配列のリスト（W 昇順の閾値ごと）。
    水準は THRESHOLDS が小さいほど高い: W=60 のみ→1、…、W=20→4。
    """
    best = 0
    n = len(THRESHOLDS)
    for k, ld in enumerate(ld_by_threshold):
        ok = False
        for node, w_in in candidates:
            if ld[node] >= t0 + w_in:
                ok = True
                break
        if ok:
            lvl = n - k      # k=0 が W=20 → 水準4
            if lvl > best:
                best = lvl
    return best


def target_deadlines(facilities, node_grid, t_end):
    """施設ごとに MAX_WALK_OUT_M 以内のノードへの降車期限を求める。{node: 秒}"""
    fd = {}
    for lat, lon in facilities:
        for node, d in node_grid.within(lat, lon, MAX_WALK_OUT_M):
            t = t_end - walk_seconds(d)
            if node not in fd or t > fd[node]:
                fd[node] = t
    return fd


def diagnose_cells(network, cells, facilities_by_type, exclude_routes=frozenset(), types=None):
    """全メッシュについて水準を計算する。

    cells: [(code, lat, lon, pop, pop65)]
    facilities_by_type: {type: [(lat, lon)]}
    戻り値: ({code: "水準の文字列"}, {code: 徒歩圏ビット}, order)
      文字列は 施設種別(order順) × 日種(wd,hol) × 時間帯(m,d,e) の順に1桁ずつ。
    """
    order = list(types or facilities_by_type.keys())
    node_pts = [(la, lo) for la, lo, _ in network.nodes]
    node_grid = Grid(node_pts)
    cand = {}
    for code, lat, lon, _p, _p65 in cells:
        cand[code] = [(i, walk_seconds(d)) for i, d in node_grid.within(lat, lon, MAX_WALK_IN_M)]
    walk_bits = {code: 0 for code, *_ in cells}
    for bit, tp in enumerate(order):
        fgrid = Grid(facilities_by_type[tp]) if facilities_by_type[tp] else None
        for code, lat, lon, _p, _p65 in cells:
            if fgrid and fgrid.within(lat, lon, WALK_ONLY_M):
                walk_bits[code] |= 1 << bit
    digits = {code: [] for code, *_ in cells}
    for tp in order:
        fac = facilities_by_type[tp]
        for dtype in ("wd", "hol"):
            conns = network.connections(dtype, exclude_routes)
            for per in PERIODS:
                t0 = START_HOURS[per] * 3600
                lds = []
                for w in THRESHOLDS:
                    fd = target_deadlines(fac, node_grid, t0 + w * 60)
                    lds.append(latest_departures(conns, network.n, fd) if fd else [NEG] * network.n)
                for code, *_ in cells:
                    digits[code].append(str(level_for(lds, cand[code], t0)))
    return {c: "".join(d) for c, d in digits.items()}, walk_bits, order
