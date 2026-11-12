"""車両位置と GTFS 時刻表から、停留所ごとの通過時刻と遅れを推定する。

方法（停留所列を折れ線とみなす近似。道路形状 shapes.txt は使わない）:
  1. 便ごとに停留所を結ぶ折れ線を作り、各停留所までの累積距離 S_i（m）を求める。
  2. 車両の観測点（時刻・緯度経度）を折れ線へ射影して、路線上の位置 s（m）を得る。
     折れ線から離れすぎた点（既定 200m 超）は捨てる。位置は戻らないものとする（単調化）。
  3. 連続する 2 観測の間に停留所があれば、その間を一定速度とみなして通過時刻を線形補間する。
     2 観測の間隔が長すぎる（既定 300 秒超）か、距離が長すぎる（既定 3000m 超）ときは推定しない。
  4. 遅れ = 推定した通過時刻 - 時刻表の発車時刻（終点は到着時刻）。秒、正が遅れ。
推定の限界は README に書いた。ここでは「推定できた分だけ」を返し、できない分は返さない。
"""
import datetime as dt
import math
from collections import defaultdict

JST = dt.timezone(dt.timedelta(hours=9))
MAX_OFFROUTE_M = 200.0
MAX_GAP_S = 300
MAX_GAP_M = 3000.0
NEAR_STOP_M = 25.0
WINDOW_BEFORE_S = 1800      # 始発の何秒前からの観測を使うか
WINDOW_AFTER_S = 5400       # 終点の何秒後までの観測を使うか
MAX_ABS_DELAY_S = 7200      # これを超える遅れ・早発は推定の誤りとみなして捨てる（2時間）


def to_xy(lat, lon, lat0):
    return (lon * math.cos(math.radians(lat0)) * 111320.0, lat * 110574.0)


def day_epoch(day: dt.date):
    """運行日の 0 時（日本時間）の epoch 秒。"""
    return dt.datetime(day.year, day.month, day.day, tzinfo=JST).timestamp()


def build_polyline(seq, stops):
    """seq=[(seq_no, stop_id, arr, dep)], stops{stop_id: (lat, lon, name)} -> (points, cum, used)
    座標のない停留所は除く。used は seq の該当要素のリスト。"""
    used = [s for s in seq if s[1] in stops]
    if len(used) < 2:
        return [], [], []
    lat0 = stops[used[0][1]][0]
    pts = [to_xy(stops[s[1]][0], stops[s[1]][1], lat0) for s in used]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return pts, cum, used


def project(pts, cum, x, y, start_seg=0):
    """点 (x,y) を折れ線に射影する。start_seg 以降の区間から最も近い点を選ぶ。(s, 距離, 区間番号)"""
    best = None
    for i in range(max(0, start_seg), len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + u * dx, ay + u * dy
        d = math.hypot(x - px, y - py)
        if best is None or d < best[1] - 1e-9:
            best = (cum[i] + u * math.sqrt(L2), d, i)
    return best


def estimate_trip(trip, stops, day: dt.date, obs, max_offroute=MAX_OFFROUTE_M, max_gap_s=MAX_GAP_S, max_gap_m=MAX_GAP_M):
    """1 便の推定。trip は gtfs.load_schedule の trips の 1 要素、obs=[(epoch秒, lat, lon)]。

    戻り値: [{"seq_no","stop_id","sched","actual","delay_s","pos":i}]（推定できた停留所だけ。pos は seq 内の順番）"""
    pts, cum, used = build_polyline(trip["seq"], stops)
    if not pts:
        return []
    lat0 = stops[used[0][1]][0]
    base = day_epoch(day)
    # 運行時間帯の外の観測は捨てる（車庫で前の運行の trip_id を出し続ける車両など）
    first_s = next((r[3] if r[3] is not None else r[2] for r in used if r[2] is not None or r[3] is not None), None)
    last_s_ = next((r[2] if r[2] is not None else r[3] for r in reversed(used) if r[2] is not None or r[3] is not None), None)
    if first_s is None or last_s_ is None:
        return []
    lo, hi = base + first_s - WINDOW_BEFORE_S, base + last_s_ + WINDOW_AFTER_S
    obs = [o for o in obs if lo <= o[0] <= hi]
    # 射影
    proj, seg = [], 0
    last_s = 0.0
    for t, lat, lon in sorted(set(obs)):
        x, y = to_xy(lat, lon, lat0)
        # 戻りを少し許すため 1 区間前から探す
        p = project(pts, cum, x, y, max(0, seg - 1))
        if p is None or p[1] > max_offroute:
            continue
        s = max(p[0], last_s)
        last_s = s
        seg = max(seg, p[2])
        proj.append((t, s))
    if len(proj) < 2:
        return []
    out = []
    n = len(used)
    for i, rec in enumerate(used):
        S = cum[i]
        sched_sec = rec[2] if i == n - 1 else rec[3]
        if sched_sec is None:
            continue
        t_est = None
        for (t0, s0), (t1, s1) in zip(proj, proj[1:]):
            if s0 <= S <= s1 and t1 - t0 <= max_gap_s and s1 - s0 <= max_gap_m:
                if s1 - s0 < 1e-6:
                    t_est = t0 if abs(S - s0) <= NEAR_STOP_M else None
                else:
                    t_est = t0 + (S - s0) / (s1 - s0) * (t1 - t0)
                break
        if t_est is None:
            continue
        sched = base + sched_sec
        if abs(t_est - sched) > MAX_ABS_DELAY_S:
            continue
        out.append({"seq_no": rec[0], "stop_id": rec[1], "sched": sched, "actual": t_est,
                    "delay_s": t_est - sched, "pos": i})
    return out


def collect_observations(records):
    """data/raw の v レコード列から、{(trip_id, 運行日 or None, 車両ID): {(ts, lat, lon)}} を作る。
    start_date が無い配信では運行日を None にし、estimate_all が時刻表との近さで決める。"""
    obs = defaultdict(set)
    for r in records:
        if r.get("kind") != "v" or not r.get("ok"):
            continue
        for row in r.get("v") or []:
            vid, trip, route, sdate, lat, lon, ts, seq, sid = row
            if not trip:
                continue
            t = ts or r.get("ft") or r["t"]
            day = None
            if sdate and len(sdate) == 8 and sdate.isdigit():
                day = dt.date(int(sdate[:4]), int(sdate[4:6]), int(sdate[6:]))
            obs[(trip, day, vid)].add((t, lat, lon))
    return obs


def resolve_day(trip, times):
    """運行日が不明なとき、観測時刻の中央値に始発が最も近くなる日（観測日・前日）を選ぶ。24時超の便に対応。"""
    mid = sorted(times)[len(times) // 2]
    d0 = dt.datetime.fromtimestamp(mid, JST).date()
    first = next((r[3] if r[3] is not None else r[2] for r in trip["seq"] if r[2] is not None or r[3] is not None), 0)
    cands = [d0 - dt.timedelta(days=1), d0]
    return min(cands, key=lambda d: abs(day_epoch(d) + first - mid))


def estimate_all(records, schedule, **kw):
    """全観測から推定する。trip_id が時刻表にある便だけ（運行日の判定は呼び出し側の schedule による）。
    戻り値: (推定の行のリスト, 件数の統計)。行には trip_id・route_id・運行日・車両ID を付ける。"""
    rows = []
    stats = {"trips_observed": 0, "trips_matched": 0, "trips_estimated": 0}
    for (trip_id, day, vid), obs in collect_observations(records).items():
        stats["trips_observed"] += 1
        tr = schedule["trips"].get(trip_id)
        if tr is None:
            continue
        stats["trips_matched"] += 1
        if day is None:
            day = resolve_day(tr, [o[0] for o in obs])
        est = estimate_trip(tr, schedule["stops"], day, sorted(obs), **kw)
        if est:
            stats["trips_estimated"] += 1
        for e in est:
            e.update({"trip_id": trip_id, "route_id": tr["route_id"], "dir": tr["dir"], "date": day.isoformat(), "vehicle": vid})
            rows.append(e)
    return rows, stats


def trip_update_delays(records):
    """TripUpdate の遅れ値（事業者が出した予測・実績）を {(trip_id, 運行日文字列, stop_sequence): delay秒} で返す。
    位置からの推定との突き合わせ（検証）用。同じキーは最後の値を採る。到着遅れ、なければ出発遅れ。"""
    out = {}
    for r in sorted((x for x in records if x.get("kind") == "u" and x.get("ok")), key=lambda x: x["t"]):
        for row in r.get("u") or []:
            trip, route, sdate, ts, delay, stops = row
            for s in stops:
                d = s[2] if s[2] is not None else s[4]
                if d is not None and s[0] is not None:
                    out[(trip, sdate, s[0])] = d
    return out
