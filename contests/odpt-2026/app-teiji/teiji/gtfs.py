"""GTFS(-JP) の読み込み（標準ライブラリのみ）。現行アプリ lifemap/gtfs.py の関数をコピーし、定時性分析向けに
「stop_sequence を残す」「bbox で絞らない」「指定日の運行判定」に作り替えた。

load_schedule(zip, day) -> {
  stops {stop_id: (lat, lon, name)}, routes {route_id: (short, long)},
  trips {trip_id: {route_id, dir, service_id, active(bool: day に運行), seq:[(stop_sequence, stop_id, arr, dep)]}},
  trip_ids（運行日を問わない全 trip_id）, start, end
}
時刻は秒（24時超を許す）。
"""
import csv
import datetime as dt
import io
import zipfile

DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def parse_time(s):
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        h, m, sec = s.split(":")
        return int(h) * 3600 + int(m) * 60 + int(sec)
    except ValueError:
        return None


def parse_date(s):
    s = (s or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:]))


def read_csv(zf, name):
    if name not in zf.namelist():
        return []
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))


def active_services(calendar, calendar_dates, day):
    active = set()
    ds = day.strftime("%Y%m%d")
    for row in calendar:
        s, e = row.get("start_date", ""), row.get("end_date", "")
        if s and e and s <= ds <= e and row.get(DOW[day.weekday()]) == "1":
            active.add(row["service_id"])
    for row in calendar_dates:
        if row.get("date") == ds:
            if row.get("exception_type") == "1":
                active.add(row["service_id"])
            elif row.get("exception_type") == "2":
                active.discard(row["service_id"])
    return active


def fill_times(seq):
    """seq=[[seq_no, stop_id, arr, dep], ...] の欠損時刻を線形補間。補えない前後は捨てる。"""
    for rec in seq:
        if rec[2] is None:
            rec[2] = rec[3]
        if rec[3] is None:
            rec[3] = rec[2]
    known = [i for i, r in enumerate(seq) if r[2] is not None]
    if len(known) < 2:
        return []
    seq = seq[known[0]:known[-1] + 1]
    known = [i for i, r in enumerate(seq) if r[2] is not None]
    for a, b in zip(known, known[1:]):
        if b - a > 1:
            t0, t1 = seq[a][3], seq[b][2]
            for k in range(a + 1, b):
                seq[k][2] = seq[k][3] = t0 + (t1 - t0) * (k - a) // (b - a)
    return seq


def load_schedule(source, day, with_stop_times=True):
    zf = zipfile.ZipFile(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source)
    stops = {}
    for r in read_csv(zf, "stops.txt"):
        try:
            stops[r["stop_id"]] = (float(r["stop_lat"]), float(r["stop_lon"]), (r.get("stop_name") or "").strip())
        except (KeyError, ValueError):
            continue
    routes = {r["route_id"]: ((r.get("route_short_name") or "").strip(), (r.get("route_long_name") or "").strip())
              for r in read_csv(zf, "routes.txt")}
    calendar = read_csv(zf, "calendar.txt")
    cdates = read_csv(zf, "calendar_dates.txt")
    svc = active_services(calendar, cdates, day)
    starts = [parse_date(r.get("start_date")) for r in calendar] + [parse_date(r.get("date")) for r in cdates]
    ends = [parse_date(r.get("end_date")) for r in calendar] + [parse_date(r.get("date")) for r in cdates]
    starts = [x for x in starts if x]
    ends = [x for x in ends if x]
    trips = {}
    for r in read_csv(zf, "trips.txt"):
        trips[r["trip_id"]] = {"trip_id": r["trip_id"], "route_id": r.get("route_id", ""), "dir": r.get("direction_id", ""),
                               "service_id": r.get("service_id", ""), "active": r.get("service_id") in svc,
                               "headsign": (r.get("trip_headsign") or "").strip(), "raw": []}
    if with_stop_times:
        for r in read_csv(zf, "stop_times.txt"):
            t = trips.get(r["trip_id"])
            if t is None:
                continue
            try:
                no = int(r["stop_sequence"])
            except (KeyError, ValueError):
                continue
            t["raw"].append((no, r["stop_id"], parse_time(r.get("arrival_time")), parse_time(r.get("departure_time"))))
    for t in trips.values():
        raw = sorted(t.pop("raw"), key=lambda x: x[0])
        t["seq"] = [tuple(x) for x in fill_times([list(x) for x in raw])]
    return {"stops": stops, "routes": routes, "trips": trips, "trip_ids": set(trips),
            "start": min(starts) if starts else None, "end": max(ends) if ends else None,
            "calendar": calendar, "calendar_dates": cdates}


def services_on(schedule, day):
    """schedule（load_schedule の結果）で、day に運行する service_id の集合。"""
    return active_services(schedule["calendar"], schedule["calendar_dates"], day)
