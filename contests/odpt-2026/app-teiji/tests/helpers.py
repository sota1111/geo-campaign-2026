"""テスト用の合成データ。現行アプリ app/tests/helpers.py の make_feed_zip をコピーして使う（現行アプリは変更しない）。"""
import csv
import datetime as dt
import io
import sys
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

JST = dt.timezone(dt.timedelta(hours=9))
DAY = dt.date(2026, 11, 18)          # 水曜
BASE = dt.datetime(2026, 11, 18, tzinfo=JST).timestamp()

LAT0, LON0 = 35.0, 139.0
M_PER_DEG_LON = 111320.0 * 0.8191520442889918   # cos(35°)


def csv_bytes(rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def make_feed_zip(stops, routes, trips, calendar, calendar_dates=()):
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
    return buf.getvalue()


def hms(sec):
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def line_stops(n=6, spacing_m=1000.0):
    """東西に一直線の n 停留所 S0..S(n-1)。間隔は spacing_m。"""
    return [(f"S{i}", f"停留所{i}", LAT0, LON0 + i * spacing_m / M_PER_DEG_LON) for i in range(n)]


def make_line_schedule(n_stops=6, starts=(8 * 3600,), run_s=300, route="R1", spacing_m=1000.0, dwell=0):
    """全便が同じ停留所列。starts は各便の始発時刻（秒）。1 停留所あたり run_s 秒。trip_id は T<時刻>。"""
    from teiji.gtfs import load_schedule
    stops = line_stops(n_stops, spacing_m)
    trips = []
    for s0 in starts:
        seq = [(f"S{i}", hms(s0 + i * run_s), hms(s0 + i * run_s + dwell)) for i in range(n_stops)]
        trips.append((f"T{s0}", route, "WD", "0", seq))
    z = make_feed_zip(stops, [(route, route, f"{route}線")], trips, [("WD", 1, 1, 1, 1, 1, 0, 0, "20260101", "20271231")])
    return load_schedule(z, DAY), z


def drive(start_s, n_stops, run_s, spacing_m, delay_s, obs_every=60, lateral_m=0.0):
    """遅れ delay_s で一定速度で走る車両の観測 [(epoch, lat, lon)]。始発〜終点を obs_every 秒おきに。"""
    obs = []
    t0 = start_s + delay_s
    total = (n_stops - 1) * run_s
    t = 0
    while t <= total:
        x = (t / run_s) * spacing_m
        obs.append((BASE + t0 + t, LAT0 + lateral_m / 110574.0, LON0 + x / M_PER_DEG_LON))
        t += obs_every
    return obs
