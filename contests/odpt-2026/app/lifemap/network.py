"""複数フィードを1つの交通網（ノード=停留所群、接続=区間運行）に統合する。"""
import math
import re

from .gtfs import DAYTYPES

# 時間帯別の発車本数の窓（時）。診断の「出発時刻」とは別物（README参照）。
WINDOWS = {"m": (6, 9), "d": (9, 16), "e": (16, 20)}
CLUSTER_NEAR_M = 40       # 名称が違っても同一地点とみなす距離
CLUSTER_SAME_NAME_M = 150  # 同名なら同一停留所群とみなす距離


def dist_m(lat1, lon1, lat2, lon2):
    """近距離用の等距離円筒近似（メートル）。"""
    kx = 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574.0)


def norm_name(name):
    n = re.sub(r"[（(].*?[）)]", "", name or "")
    return re.sub(r"[\s　・･]", "", n)


def cluster_stops(stops):
    """stops=[(key, lat, lon, name)] -> (node_of{key: idx}, nodes[(lat, lon, name)])。

    距離 CLUSTER_NEAR_M 以内、または同名で CLUSTER_SAME_NAME_M 以内の停留所を同一ノードに併合する。
    """
    parent = list(range(len(stops)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = 0.002
    grid = {}
    for i, (_, lat, lon, _n) in enumerate(stops):
        grid.setdefault((int(lat / cell), int(lon / cell)), []).append(i)
    norm = [norm_name(s[3]) for s in stops]
    for i, (_, lat, lon, _n) in enumerate(stops):
        gy, gx = int(lat / cell), int(lon / cell)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    if j <= i:
                        continue
                    d = dist_m(lat, lon, stops[j][1], stops[j][2])
                    if d <= CLUSTER_NEAR_M or (d <= CLUSTER_SAME_NAME_M and norm[i] and norm[i] == norm[j]):
                        a, b = find(i), find(j)
                        if a != b:
                            parent[b] = a
    groups = {}
    for i in range(len(stops)):
        groups.setdefault(find(i), []).append(i)
    node_of, nodes = {}, []
    for members in groups.values():
        lat = sum(stops[i][1] for i in members) / len(members)
        lon = sum(stops[i][2] for i in members) / len(members)
        names = [stops[i][3] for i in members if stops[i][3]]
        name = max(set(names), key=names.count) if names else ""
        for i in members:
            node_of[stops[i][0]] = len(nodes)
        nodes.append((lat, lon, name))
    return node_of, nodes


class Network:
    """feeds: load_feed() の戻り値のリスト（feed_keys と同順）。"""

    def __init__(self, feeds, feed_keys):
        stop_list = []
        for fk, fd in zip(feed_keys, feeds):
            used = {sid for t in fd["trips"] for sid, _, _ in t["seq"]}
            for sid in used:
                lat, lon, name = fd["stops"][sid]
                stop_list.append(((fk, sid), lat, lon, name))
        node_of, nodes = cluster_stops(stop_list)
        # 使われたノードのみ。空間順に並べ替えず、そのまま採番。
        self.nodes = nodes
        self.n = len(nodes)
        self.routes = []   # [(feed_idx, route_id, short, long, color)]
        route_idx = {}
        self.trips = {dt_: [] for dt_ in DAYTYPES}   # dt -> [(route_idx, [(node, arr, dep)])]
        for fi, (fk, fd) in enumerate(zip(feed_keys, feeds)):
            for t in fd["trips"]:
                rk = (fi, t["route_id"])
                if rk not in route_idx:
                    short, long_, color = fd["routes"].get(t["route_id"], ("", "", ""))
                    route_idx[rk] = len(self.routes)
                    self.routes.append((fi, t["route_id"], short, long_, color))
                seq = [(node_of[(fk, sid)], a, d) for sid, a, d in t["seq"]]
                # 同一ノードの連続停車は1つにまとめる
                comp = []
                for nd, a, d in seq:
                    if comp and comp[-1][0] == nd:
                        comp[-1] = (nd, comp[-1][1], d)
                    else:
                        comp.append((nd, a, d))
                if len(comp) < 2:
                    continue
                for dtype in DAYTYPES:
                    if t["active"][dtype]:
                        self.trips[dtype].append((route_idx[rk], comp, t["dir"]))
        self._base = {}

    def connections(self, dtype, exclude_routes=frozenset()):
        """後退走査用に出発時刻の降順で整列した接続列 (dep, arr, from, to, trip_no)。路線の除外が可能。"""
        if dtype not in self._base:
            rows = []
            for tno, (_ridx, seq, _dir) in enumerate(self.trips[dtype]):
                for i in range(len(seq) - 1):
                    rows.append((seq[i][2], seq[i + 1][1], seq[i][0], seq[i + 1][0], tno))
            # 同時刻の接続は便の後ろ側を先に処理する（発生順の逆）
            order = sorted(range(len(rows)), key=lambda k: (-rows[k][0], -k))
            self._base[dtype] = [rows[k] for k in order]
        base = self._base[dtype]
        if not exclude_routes:
            return base
        route_of = [t[0] for t in self.trips[dtype]]
        return [c for c in base if route_of[c[4]] not in exclude_routes]

    def node_stats(self, dtype):
        """ノード別: 窓別の発車本数 [朝, 昼, 夕, 全日] と 始発・終発（分, なければ -1）、路線集合。"""
        cnt = [[0, 0, 0, 0] for _ in range(self.n)]
        first = [None] * self.n
        last = [None] * self.n
        routes = [set() for _ in range(self.n)]
        for ridx, seq, _d in self.trips[dtype]:
            seen = set()
            for nd, _a, dep in seq[:-1]:
                routes[nd].add(ridx)
                if nd in seen:
                    continue
                seen.add(nd)
                h = dep / 3600.0
                for k, (lo, hi) in enumerate(WINDOWS.values()):
                    if lo <= h < hi:
                        cnt[nd][k] += 1
                cnt[nd][3] += 1
                first[nd] = dep if first[nd] is None else min(first[nd], dep)
                last[nd] = dep if last[nd] is None else max(last[nd], dep)
        return cnt, first, last, routes
