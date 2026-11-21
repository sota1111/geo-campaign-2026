"""GTFS から「系統パターン」と「観光地点に近い停留所」を作り、系統×時間帯の集計を出す。標準ライブラリのみ。

推定の方法（画面・README にも書く）:
  1. 観光地点（国土数値情報 P12-14 観光資源）から NEAR_M 以内（直線）にある停留所を「観光地点に近い停留所」とする。
  2. 系統ごとに、停留所のうち観光地点に近いものの割合 share を求める（事実から計算した値）。
  3. 系統×時間帯ごとに、観光地点に近い停留所へ停車する便数・停車回数を数える（時刻表から数えた値）。
  実際の乗客数・混雑は GTFS にも観光資源データにも含まれないので、「観光客が多い」ことは推定でしかない。
"""
import math
import unicodedata

NEAR_M = 300          # 観光地点から停留所までの距離（直線）。仮定。画面にも表示する
EARTH_R = 6371008.8


def norm(s):
    return unicodedata.normalize("NFKC", s or "").strip()


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


class Grid:
    """緯度経度の格子（約 cell_m）で近傍検索する。"""

    def __init__(self, cell_m=250.0):
        self.dlat = cell_m / 111320.0
        self.cell_m = cell_m
        self.cells = {}

    def _key(self, lat, lon):
        dlon = self.cell_m / (111320.0 * math.cos(math.radians(lat)))
        return int(lat // self.dlat), int(lon // dlon)

    def add(self, i, lat, lon):
        self.cells.setdefault(self._key(lat, lon), []).append((i, lat, lon))

    def within(self, lat, lon, r_m):
        ky, kx = self._key(lat, lon)
        out = []
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                for i, la, lo in self.cells.get((ky + dy, kx + dx), ()):
                    d = haversine(lat, lon, la, lo)
                    if d <= r_m:
                        out.append((i, d))
        return sorted(out, key=lambda x: x[1])


def build_patterns(feeds):
    """feeds: [{key, name, data(load_feed の戻り値)}] -> (stops, routes, patterns)

    stops: [{id, lat, lon, name, feed}]（停留所の通し番号 = 配列位置）
    routes: [{key, feed, name}]
    patterns: [{route, stops:[停留所番号], off:[先頭停留所の出発からの秒], dep:{wd:[先頭の出発秒], hol:[...]}}]
      同じ系統・同じ停留所列・同じ所要時間の便を1パターンにまとめる。時刻は出発時刻（なければ到着）で代表させる。
    """
    stops, stop_idx = [], {}
    routes, route_idx = [], {}
    pat = {}
    for fd in feeds:
        d = fd["data"]
        for t in d["trips"]:
            rid = fd["key"] + ":" + t["route_id"]
            if rid not in route_idx:
                short, long_, _ = d["routes"].get(t["route_id"], ("", "", ""))
                nm = norm(short) or norm(long_) or t["route_id"]
                route_idx[rid] = len(routes)
                routes.append({"key": rid, "feed": fd["key"], "name": nm, "long": norm(long_) if short else ""})
            seq = []
            for sid, arr, dep in t["seq"]:
                tm = dep if dep is not None else arr
                if tm is None:
                    continue
                gk = fd["key"] + ":" + sid
                if gk not in stop_idx:
                    la, lo, nm = d["stops"][sid]
                    stop_idx[gk] = len(stops)
                    stops.append({"id": gk, "lat": la, "lon": lo, "name": norm(nm), "feed": fd["key"]})
                seq.append((stop_idx[gk], tm))
            # 同じ停留所が連続する記録（始発の重複など）は後ろを捨てる
            clean = [seq[0]] if seq else []
            for s, tm in seq[1:]:
                if s != clean[-1][0]:
                    clean.append((s, max(tm, clean[-1][1])))
            if len(clean) < 2:
                continue
            t0 = clean[0][1]
            key = (route_idx[rid], tuple(s for s, _ in clean), tuple(tm - t0 for _, tm in clean))
            p = pat.setdefault(key, {"wd": [], "hol": []})
            for dt in ("wd", "hol"):
                if t["active"][dt]:
                    p[dt].append(t0)
    patterns = []
    for (r, ss, off), deps in pat.items():
        patterns.append({"route": r, "stops": list(ss), "off": list(off),
                         "dep": {"wd": sorted(deps["wd"]), "hol": sorted(deps["hol"])}})
    patterns.sort(key=lambda p: (p["route"], p["stops"], p["off"]))
    return stops, routes, patterns


def tourist_stops(stops, spots, near_m=NEAR_M):
    """各停留所の最寄りの観光地点（near_m 以内）。{停留所番号: (観光地点番号, 距離m)}"""
    g = Grid(max(near_m, 100.0))
    for i, s in enumerate(spots):
        g.add(i, s["lat"], s["lon"])
    out = {}
    for i, s in enumerate(stops):
        near = g.within(s["lat"], s["lon"], near_m)
        if near:
            out[i] = (near[0][0], round(near[0][1]))
    return out


def route_summary(stops, routes, patterns, tstop):
    """系統ごとの停留所数・観光地点に近い停留所数・割合、1日の便数。"""
    st = [set() for _ in routes]
    trips = [{"wd": 0, "hol": 0} for _ in routes]
    for p in patterns:
        st[p["route"]].update(p["stops"])
        for dt in ("wd", "hol"):
            trips[p["route"]][dt] += len(p["dep"][dt])
    out = []
    for i, r in enumerate(routes):
        n = len(st[i])
        k = sum(1 for s in st[i] if s in tstop)
        names = sorted({tstop[s][0] for s in st[i] if s in tstop})
        out.append({"name": r["name"], "feed": r["feed"], "stops": n, "tstops": k,
                    "share": round(k / n, 4) if n else 0.0, "spots": names,
                    "trips_wd": trips[i]["wd"], "trips_hol": trips[i]["hol"]})
    return out


def hourly_table(routes, patterns, tstop):
    """系統×日種別×時間帯。観光地点に近い停留所へ停車する便数（trips）と停車回数（visits）。

    時間帯は停車時刻の「時」。24時を過ぎる便は 24, 25... のまま（深夜帯）。
    [{route, dt, hour, trips, visits}]
    """
    acc = {}
    for p in patterns:
        hit = [(i, o) for i, (s, o) in enumerate(zip(p["stops"], p["off"])) if s in tstop]
        if not hit:
            continue
        for dt in ("wd", "hol"):
            for t0 in p["dep"][dt]:
                seen = set()
                for _, o in hit:
                    h = (t0 + o) // 3600
                    a = acc.setdefault((p["route"], dt, h), [0, 0])
                    a[1] += 1
                    if h not in seen:
                        seen.add(h)
                        a[0] += 1
    return [{"route": r, "dt": dt, "hour": h, "trips": v[0], "visits": v[1]}
            for (r, dt, h), v in sorted(acc.items())]
