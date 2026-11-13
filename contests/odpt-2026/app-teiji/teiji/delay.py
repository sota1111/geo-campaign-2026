"""車両位置と GTFS 時刻表から、停留所ごとの通過時刻と遅れを推定する。

方法（停留所列を折れ線とみなす近似。道路形状 shapes.txt は使わない）:
  1. 便ごとに停留所を結ぶ折れ線を作り、各停留所までの累積距離 S_i（m）を求める。
  2. 車両の観測点（時刻・緯度経度）を折れ線へ射影して、路線上の位置 s（m）を得る。
     各観測は、折れ線から既定 200m 以内の「候補の位置」を複数持つ（ループ線・往復線では同じ場所が複数の s に当たる）。
     観測を時刻順に並べ、候補の列を「前回位置から後ろへ 40m まで・先へ（最高速度 25m/秒 × 経過時間 + 60m）まで」
     の範囲だけを許して動的計画法で選ぶ。これで終点側・復路側への飛びを防ぐ。許される経路が無いときは、
     そこで経路を切り（補間しない）、新しく始める。
  3. 停留所ごとに「停留所圏（既定 ±25m）に入った時刻」と「出た時刻」を位置の折れ線から線形補間で求める。
     圏内に 30 秒以上いた（停車・待機）なら、着=入った時刻、発=出た時刻。短ければ通過とみなし、
     停留所の位置を通った時刻を着・発の両方に使う。圏内から観測が始まり、出る所が観測できない停留所
     （始発の待機の途中など）は推定しない。2 観測の間隔が長すぎる（既定 300 秒超）か、距離が長すぎる（既定 3000m 超）
     ときも推定しない。
  4. 遅れ = 推定した発車時刻 - 時刻表の発車時刻（終点は到着時刻どうしを比べる）。秒、正が遅れ。
     到着の遅れ（arr_delay_s）も、着が観測できたときは別に持つ。
推定の限界は README に書いた。ここでは「推定できた分だけ」を返し、できない分は返さない。
"""
import datetime as dt
import math
from collections import defaultdict

JST = dt.timezone(dt.timedelta(hours=9))
MAX_OFFROUTE_M = 200.0
MAX_GAP_S = 300
MAX_GAP_M = 3000.0
NEAR_STOP_M = 25.0          # 停留所圏の半径（m）
DWELL_MIN_S = 30            # 圏内にこれ以上いたら「停車」とみなす
MAX_SPEED_MPS = 25.0        # 位置の移動として許す最高速度（90km/h）。凍結した位置の後の「瞬間移動」を除く
BACK_TOL_M = 40.0           # GPS の揺れとして許す後戻り
FWD_SLACK_M = 60.0
MAX_CANDS = 8
RESTART_PEN = 1e6
WINDOW_BEFORE_S = 1800      # 始発の何秒前からの観測を使うか
WINDOW_AFTER_S = 5400       # 終点の何秒後までの観測を使うか
MAX_ABS_DELAY_S = 7200      # これを超える遅れ・早発は推定の誤りとみなして捨てる（2時間）
NIGHT_END_H = 4             # start_date が無い観測の運行日: 0〜4時の観測は、窓に合う便が無ければ前日の運行とみなす


def norm_ts(ts):
    """ミリ秒で配信されるタイムスタンプを秒にする。"""
    if ts is not None and ts > 1e11:
        return int(ts / 1000)
    return ts


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


def candidates(pts, cum, x, y, max_offroute):
    """点 (x,y) の、折れ線上の候補 [(距離, s)]。近い順。s が 2m 以内で重なるものは近い方だけ。最大 MAX_CANDS 個。"""
    cs = []
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        d = math.hypot(x - (ax + u * dx), y - (ay + u * dy))
        if d <= max_offroute:
            cs.append((d, cum[i] + u * math.sqrt(L2)))
    cs.sort()
    out = []
    for d, s in cs:
        if all(abs(s - o[1]) > 2.0 for o in out):
            out.append((d, s))
            if len(out) >= MAX_CANDS:
                break
    return out


def fit_path(layers):
    """layers=[(t, [(d, s), ...])] から、前回位置の近傍（後ろへ BACK_TOL_M、先へ 最高速度×経過時間+余裕）に収まる
    経路を、距離の合計が最小になるように選ぶ。戻り値 [(t, s, 切れ目)]。切れ目=直前とつながらない（経路を切った）。"""
    if not layers:
        return []
    costs = [d for d, s in layers[0][1]]
    back = [[(-1, False)] * len(costs)]
    for k in range(1, len(layers)):
        t0, prev = layers[k - 1]
        t1, cur = layers[k]
        lim = MAX_SPEED_MPS * (t1 - t0) + FWD_SLACK_M
        pj_min = min(range(len(prev)), key=lambda j: costs[j])
        nc, nb = [], []
        for d, s in cur:
            best, bj = None, -1
            for j, (_, ps) in enumerate(prev):
                if -BACK_TOL_M <= s - ps <= lim and (best is None or costs[j] < best):
                    best, bj = costs[j], j
            if best is None:
                nc.append(costs[pj_min] + RESTART_PEN + d)
                nb.append((pj_min, True))
            else:
                nc.append(best + d)
                nb.append((bj, False))
        costs = nc
        back.append(nb)
    j = min(range(len(costs)), key=lambda i: costs[i])
    path = []
    for k in range(len(layers) - 1, -1, -1):
        pj, brk = back[k][j]
        path.append((layers[k][0], layers[k][1][j][1], brk))
        j = pj
    path.reverse()
    # 一つの連なりの中では位置は戻らない（GPS の揺れの後戻りを平らにする）
    out, last = [], None
    for t, s, brk in path:
        if brk or last is None:
            last = s
        else:
            last = max(last, s)
        out.append((t, last, brk))
    return out


def stop_times(path, valid, S, is_last):
    """path=[(t,s)]・valid[i]=区間 i→i+1 を補間してよいか、から停留所（累積距離 S）の (着, 発) を返す（不明は None）。
    終点は (着, None)。"""
    lo, hi = S - NEAR_STOP_M, S + NEAR_STOP_M

    def interp(i, level):
        (t0, s0), (t1, s1) = path[i], path[i + 1]
        return t0 + (level - s0) / (s1 - s0) * (t1 - t0)

    t_in = t_out = t_pass = None
    for i in range(len(path) - 1):
        s0, s1 = path[i][1], path[i + 1][1]
        if s1 <= s0 or not valid[i]:
            continue
        if t_in is None and s0 < lo <= s1:
            t_in = interp(i, lo)
        if s0 <= hi < s1:
            t_out = interp(i, hi)
        if t_pass is None and s0 <= S <= s1:
            t_pass = interp(i, S)
    begins_in = lo <= path[0][1] <= hi
    start = t_in if t_in is not None else (path[0][0] if begins_in else None)
    if is_last:
        return (t_pass if t_pass is not None else t_in), None
    if t_out is not None and start is not None and t_out - start >= DWELL_MIN_S:
        return t_in, t_out          # 停車: 着=入った時刻、発=出た時刻
    return t_pass, t_pass           # 通過


def estimate_trip(trip, stops, day: dt.date, obs, max_offroute=MAX_OFFROUTE_M, max_gap_s=MAX_GAP_S, max_gap_m=MAX_GAP_M):
    """1 便の推定。trip は gtfs.load_schedule の trips の 1 要素、obs=[(epoch秒, lat, lon)]。

    戻り値: [{"seq_no","stop_id","sched","actual","delay_s","pos":i, "arr_actual","arr_sched","arr_delay_s"}]
    （推定できた停留所だけ。actual・delay_s は発車、終点は到着。arr_* は着が観測できたときだけ値が入る。pos は seq 内の順番）"""
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
    layers = []
    for t, lat, lon in sorted(set(obs)):
        x, y = to_xy(lat, lon, lat0)
        cs = candidates(pts, cum, x, y, max_offroute)
        if cs:
            layers.append((t, cs))
    if len(layers) < 2:
        return []
    fit = fit_path(layers)
    path = [(t, s) for t, s, _ in fit]
    valid = [(not fit[i + 1][2]) and path[i + 1][0] - path[i][0] <= max_gap_s and path[i + 1][1] - path[i][1] <= max_gap_m
             for i in range(len(path) - 1)]
    out = []
    n = len(used)
    for i, rec in enumerate(used):
        last = i == n - 1
        sched_sec = rec[2] if last else rec[3]
        if sched_sec is None:
            sched_sec = rec[3] if last else rec[2]
        if sched_sec is None:
            continue
        arr, dep = stop_times(path, valid, cum[i], last)
        t_est = arr if last else dep
        if t_est is None:
            continue
        sched = base + sched_sec
        if abs(t_est - sched) > MAX_ABS_DELAY_S:
            continue
        row = {"seq_no": rec[0], "stop_id": rec[1], "sched": sched, "actual": t_est, "delay_s": t_est - sched, "pos": i,
               "arr_actual": None, "arr_sched": None, "arr_delay_s": None}
        if not last and arr is not None and rec[2] is not None and abs(arr - (base + rec[2])) <= MAX_ABS_DELAY_S:
            row.update({"arr_actual": arr, "arr_sched": base + rec[2], "arr_delay_s": arr - (base + rec[2])})
        out.append(row)
    return out


def op_day(tr, t):
    """start_date が無い観測の運行日。観測時刻（JST）の日と前日のうち、便の運行時間帯（始発の前 WINDOW_BEFORE_S 〜 終点の後 WINDOW_AFTER_S）
    に入る方。両方・どちらにも入らないときは、深夜帯（0〜4時）の観測を前日の運行日とする。"""
    d0 = dt.datetime.fromtimestamp(t, JST)
    today, prev = d0.date(), d0.date() - dt.timedelta(days=1)
    if tr is not None:
        secs = [x for r in tr["seq"] for x in (r[2], r[3]) if x is not None]
        if secs:
            lo, hi = min(secs) - WINDOW_BEFORE_S, max(secs) + WINDOW_AFTER_S
            ins = [d for d in (prev, today) if day_epoch(d) + lo <= t <= day_epoch(d) + hi]
            if len(ins) == 1:
                return ins[0]
    return prev if d0.hour < NIGHT_END_H else today


def merge_unstable_vehicles(groups):
    """車両ID が毎回変わる配信（vehicle.id が無く entity.id で代用）の対策。同じ便・運行日の中で、観測が 1 点だけの
    車両IDが 3 つ以上あれば、それらを 1 台の車両にまとめる。"""
    by_trip = defaultdict(list)
    for (trip, vid), o in groups.items():
        by_trip[trip].append((vid, o))
    out = {}
    for trip, lst in by_trip.items():
        singles = [o for v, o in lst if len(o) <= 1]
        if len(singles) >= 3:
            merged = set()
            for o in singles:
                merged |= o
            out[(trip, "?")] = merged
            lst = [(v, o) for v, o in lst if len(o) > 1]
        for v, o in lst:
            out[(trip, v)] = o
    return out


def iter_days(records, schedule, lag_days=2):
    """記録（時刻順）を読みながら、運行日ごとの観測 {(trip_id, 車両ID): {(ts, lat, lon)}} を (運行日, 観測) で返す。
    運行日が確定した（それより lag_days 日以上あとの記録を読んだ）日から順に返し、メモリに残すのは数日分だけ。
    start_date があればそれを、無ければ op_day で補う。"""
    pending = defaultdict(lambda: defaultdict(set))
    latest = None
    trips = schedule["trips"] if schedule else {}
    for r in records:
        if r.get("kind") != "v" or not r.get("ok"):
            continue
        for row in r.get("v") or []:
            vid, trip, route, sdate, lat, lon, ts, seq, sid = row
            if not trip:
                continue
            t = norm_ts(ts) or r.get("ft") or r["t"]
            if sdate and len(sdate) == 8 and sdate.isdigit():
                day = dt.date(int(sdate[:4]), int(sdate[4:6]), int(sdate[6:]))
            else:
                day = op_day(trips.get(trip), t)
            pending[day][(trip, vid)].add((t, lat, lon))
        cur = dt.datetime.fromtimestamp(r["t"], JST).date()
        if latest is None or cur > latest:
            latest = cur
            for d in sorted(d for d in pending if d <= latest - dt.timedelta(days=lag_days)):
                yield d, merge_unstable_vehicles(pending.pop(d))
    for d in sorted(pending):
        yield d, merge_unstable_vehicles(pending.pop(d))


def estimate_day(day, groups, schedule, **kw):
    """1 運行日分の推定。戻り値 (行のリスト, 件数の統計)。"""
    rows = []
    stats = {"trips_observed": 0, "trips_matched": 0, "trips_estimated": 0}
    for (trip_id, vid), obs in groups.items():
        stats["trips_observed"] += 1
        tr = schedule["trips"].get(trip_id)
        if tr is None:
            continue
        stats["trips_matched"] += 1
        est = estimate_trip(tr, schedule["stops"], day, sorted(obs), **kw)
        if est:
            stats["trips_estimated"] += 1
        for e in est:
            e.update({"trip_id": trip_id, "route_id": tr["route_id"], "dir": tr["dir"], "date": day.isoformat(), "vehicle": vid})
            rows.append(e)
    return rows, stats


def estimate_days(records, schedule, **kw):
    """運行日ごとに推定して (運行日, 行, 統計) を順に返す（ストリーミング）。records は 1 回だけ読む。"""
    for day, groups in iter_days(records, schedule):
        rows, stats = estimate_day(day, groups, schedule, **kw)
        yield day, rows, stats


def estimate_all(records, schedule, **kw):
    """全観測から推定する（小さいデータ用。大きいデータは estimate_days を使う）。
    trip_id が時刻表にある便だけ。戻り値: (推定の行のリスト, 件数の統計)。行には trip_id・route_id・運行日・車両ID を付ける。"""
    rows = []
    stats = {"trips_observed": 0, "trips_matched": 0, "trips_estimated": 0}
    for _, r, s in estimate_days(records, schedule, **kw):
        rows += r
        for k in stats:
            stats[k] += s[k]
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
