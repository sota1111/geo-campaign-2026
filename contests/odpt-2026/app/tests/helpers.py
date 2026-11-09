"""テスト用の合成データ作成と、診断ロジックの独立した参照実装（前方探索）。"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from lifemap import access  # noqa: E402


def csv_bytes(rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def make_feed_zip(stops, routes, trips, calendar, calendar_dates=(), feed_info=None):
    """stops [(id, name, lat, lon)], routes [(id, short, long)],
    trips [(trip_id, route_id, service_id, dir, [(stop_id, arr, dep), ...])]（時刻は 'H:MM:SS' か ''）"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("stops.txt", csv_bytes([["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [list(s) for s in stops]))
        z.writestr("routes.txt", csv_bytes([["route_id", "route_short_name", "route_long_name", "route_color"]]
                                           + [[r[0], r[1], r[2], ""] for r in routes]))
        z.writestr("trips.txt", csv_bytes([["route_id", "service_id", "trip_id", "direction_id"]]
                                          + [[t[1], t[2], t[0], t[3]] for t in trips]))
        st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]
        for t in trips:
            for i, (sid, a, d) in enumerate(t[4]):
                st.append([t[0], a, d, sid, i + 1])
        z.writestr("stop_times.txt", csv_bytes(st))
        z.writestr("calendar.txt", csv_bytes([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday",
                                               "saturday", "sunday", "start_date", "end_date"]] + [list(c) for c in calendar]))
        if calendar_dates:
            z.writestr("calendar_dates.txt", csv_bytes([["service_id", "date", "exception_type"]] + [list(c) for c in calendar_dates]))
        if feed_info:
            z.writestr("feed_info.txt", csv_bytes([["feed_start_date", "feed_end_date"], list(feed_info)]))
    return buf.getvalue()


def reference_levels(conns, n_nodes, candidates, facility_nodes, t0, transfer_s=access.TRANSFER_S):
    """前方探索（独立実装）。candidates [(node, walk_in_s)], facility_nodes {node: walk_out_s}。
    戻り値: 到達できる最小の W（分）または None。conns は (dep, arr, u, v, trip)。"""
    inf = float("inf")
    walk_ready = [inf] * n_nodes
    arr_time = [inf] * n_nodes
    for node, w in candidates:
        walk_ready[node] = min(walk_ready[node], t0 + w)
    boarded = set()
    for dep, arr, u, v, trip in sorted(conns, key=lambda c: (c[0], c[4])):
        if trip in boarded or dep >= min(walk_ready[u], arr_time[u] + transfer_s):
            boarded.add(trip)
            if arr < arr_time[v]:
                arr_time[v] = arr
    best = None
    for node, w_out in facility_nodes.items():
        if arr_time[node] < inf:
            minutes = (arr_time[node] + w_out - t0) / 60.0
            if best is None or minutes < best:
                best = minutes
    return best


def threshold_level(minutes):
    """最小所要分 -> 水準（access.level_for と同じ定義）。"""
    if minutes is None:
        return 0
    n = len(access.THRESHOLDS)
    for k, w in enumerate(access.THRESHOLDS):
        if minutes <= w:
            return n - k
    return 0


def make_mesh_zip(rows):
    """rows: [(10桁コード, 人口, 65歳以上 or '*')] を e-Stat 形式(cp932)の zip に。"""
    head = ["KEY_CODE", "HTKSYORI", "HTKSAKI", "GASSAN"] + [f"T001102{i:03d}" for i in range(1, 51)]
    jp = ["", "", "", ""] + ["x"] * 50
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(head)
    w.writerow(jp)
    for code, pop, p65 in rows:
        r = [code, "0", "", "", str(pop)] + ["*"] * 49
        r[22] = str(p65)
        w.writerow(r)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("tblT001102Q0000.txt", buf.getvalue().encode("cp932"))
    return out.getvalue()


def make_geojson_zip(features, name="x.geojson"):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(name, json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False).encode("utf-8"))
    return out.getvalue()
