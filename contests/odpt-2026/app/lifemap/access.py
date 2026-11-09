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
RAIL_WALK_MIN = 15         # 鉄道駅まで徒歩この分数以内（徒歩モデルで換算）のメッシュを「鉄道あり（未評価）」とする
TRANSFER_S = 180           # 乗継に必要な最小時間（秒）
THRESHOLDS = (20, 30, 45, 60)   # 分。小さい方が良い
START_HOURS = {"m": 8, "d": 12, "e": 17}   # 出発時刻（時）
PERIODS = ("m", "d", "e")
NEG = -10 ** 9


def walk_seconds(d_m):
    return d_m * DETOUR / WALK_MPS


def walk_level(d_m):
    """徒歩だけで施設へ着ける水準。公共交通の水準と同じ尺度（W=20分→4 … W=60分→1、0は許容時間内に歩けない）。
    判定は徒歩モデル（直線×DETOUR÷分速80m）と許容時間 THRESHOLDS をそのまま使う。"""
    n = len(THRESHOLDS)
    sec = walk_seconds(d_m)
    for k, w in enumerate(THRESHOLDS):
        if sec <= w * 60:
            return n - k
    return 0


def max_walk_m():
    """最大の許容時間で歩ける直線距離（m）。"""
    return THRESHOLDS[-1] * 60 / walk_seconds(1.0)


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


class Diagnoser:
    """メッシュ・施設・ノードの前計算を1回だけ行い、路線除外の再計算を安く回せるようにする。"""

    def __init__(self, network, cells, facilities_by_type, types=None):
        self.network = network
        self.cells = cells
        self.order = list(types or facilities_by_type.keys())
        node_grid = Grid([(la, lo) for la, lo, _ in network.nodes])
        self.cand = [[(i, walk_seconds(d)) for i, d in node_grid.within(lat, lon, MAX_WALK_IN_M)]
                     for _code, lat, lon, _p, _p65 in cells]
        self.walk_lv = [[0] * len(self.order) for _ in cells]   # メッシュ × 施設種別: 徒歩だけで着ける水準
        self.deadlines = {}   # (type, period) -> [W ごとの {node: 期限秒}]
        for bit, tp in enumerate(self.order):
            fac = facilities_by_type[tp]
            fgrid = Grid(fac) if fac else None
            reach = max_walk_m()
            for k, (_code, lat, lon, _p, _p65) in enumerate(cells):
                if fgrid:
                    near = [d for _i, d in fgrid.within(lat, lon, reach)]
                    if near:
                        self.walk_lv[k][bit] = walk_level(min(near))
            for per in PERIODS:
                t0 = START_HOURS[per] * 3600
                self.deadlines[(tp, per)] = [target_deadlines(fac, node_grid, t0 + w * 60) for w in THRESHOLDS]

    def walk_string(self, k):
        return "".join(str(x) for x in self.walk_lv[k])

    def levels(self, exclude_routes=frozenset()):
        """各メッシュの水準の文字列（施設 × 日種(wd,hol) × 時間帯(m,d,e) の順に1桁ずつ）を返す。"""
        net = self.network
        digits = [[] for _ in self.cells]
        for tp in self.order:
            for dtype in ("wd", "hol"):
                conns = net.connections(dtype, exclude_routes)
                for per in PERIODS:
                    t0 = START_HOURS[per] * 3600
                    lds = [latest_departures(conns, net.n, fd) if fd else [NEG] * net.n
                           for fd in self.deadlines[(tp, per)]]
                    for k in range(len(self.cells)):
                        digits[k].append(str(level_for(lds, self.cand[k], t0)))
        return ["".join(d) for d in digits]


def diagnose_cells(network, cells, facilities_by_type, exclude_routes=frozenset(), types=None):
    """全メッシュについて水準を計算する（Diagnoser の薄い包み）。

    cells: [(code, lat, lon, pop, pop65)]、facilities_by_type: {type: [(lat, lon)]}
    戻り値: ({code: 水準の文字列}, {code: 徒歩だけで着ける水準（施設種別ごと1桁）の文字列}, order)
    """
    dg = Diagnoser(network, cells, facilities_by_type, types)
    lv = dg.levels(exclude_routes)
    return ({c[0]: lv[k] for k, c in enumerate(cells)}, {c[0]: dg.walk_string(k) for k, c in enumerate(cells)}, dg.order)
