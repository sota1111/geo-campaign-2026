"""都営バスの GTFS-JP（ODPT・CC BY 4.0・トークン不要）から、バス停ごとの運行本数を数える。

基準日: 平日=フィード開始日以降の最初の水曜、休日=同じく最初の日曜。
calendar と calendar_dates から運行する便を決め、各便の「終点以外の停車」の発時刻を数える。
"""
import csv
import datetime as dt
import io
import zipfile

from .geo import haversine_m

DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
URL = "https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip"


def parse_time(s):
    """'H:MM:SS' -> 秒。空欄・不正は None。24時超を許す。"""
    try:
        h, m, sec = (s or "").strip().split(":")
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
    ds = day.strftime("%Y%m%d")
    active = set()
    for row in calendar:
        if row.get("start_date", "") <= ds <= row.get("end_date", "") and row.get(DOW[day.weekday()]) == "1":
            active.add(row["service_id"])
    for row in calendar_dates:
        if row.get("date") == ds:
            if row.get("exception_type") == "1":
                active.add(row["service_id"])
            elif row.get("exception_type") == "2":
                active.discard(row["service_id"])
    return active


def first_weekday_on_or_after(start, weekday):
    return start + dt.timedelta(days=(weekday - start.weekday()) % 7)


def hhmm(sec):
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def load_bus_stops(zip_path, bbox, merge_m=80):
    """bbox=(south, west, north, east) 内のバス停（親駅でまとめた停留所）の運行本数。

    戻り値: (stops, meta)。stops は
      [{id, name, lat, lon, wd, hol, first, last, hourly[24], routes[名前...]}]
    """
    s, w, n, e = bbox
    with zipfile.ZipFile(zip_path) as zf:
        stops_rows = read_csv(zf, "stops.txt")
        calendar = read_csv(zf, "calendar.txt")
        cdates = read_csv(zf, "calendar_dates.txt")
        trips = read_csv(zf, "trips.txt")
        routes = {r["route_id"]: r for r in read_csv(zf, "routes.txt")}
        feed = read_csv(zf, "feed_info.txt")
        start = parse_date(feed[0].get("feed_start_date")) if feed else None
        end = parse_date(feed[0].get("feed_end_date")) if feed else None
        if start is None:
            start = min(parse_date(r["start_date"]) for r in calendar)
        ref = {"wd": first_weekday_on_or_after(start, 2), "hol": first_weekday_on_or_after(start, 6)}
        svc = {k: active_services(calendar, cdates, d) for k, d in ref.items()}
        trip_info = {t["trip_id"]: (t["service_id"], t["route_id"]) for t in trips}
        day_of = {}  # trip_id -> ["wd","hol"]
        for tid, (sv, _) in trip_info.items():
            ks = [k for k in ("wd", "hol") if sv in svc[k]]
            if ks:
                day_of[tid] = ks

        # 範囲内の停留所（location_type=0 の標柱）
        poles = {}
        for r in stops_rows:
            if r.get("location_type", "0") not in ("", "0"):
                continue
            try:
                lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
            except ValueError:
                continue
            if s <= lat <= n and w <= lon <= e:
                poles[r["stop_id"]] = {"name": r["stop_name"], "lat": lat, "lon": lon,
                                       "group": r.get("parent_station") or r["stop_id"]}

        # stop_times を1回走査: 便ごとの最大 stop_sequence と、範囲内の候補行
        max_seq = {}
        cand = []
        with zf.open("stop_times.txt") as f:
            for row in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")):
                tid = row["trip_id"]
                if tid not in day_of:
                    continue
                try:
                    seq = int(row["stop_sequence"])
                except ValueError:
                    continue
                if seq > max_seq.get(tid, -1):
                    max_seq[tid] = seq
                sid = row["stop_id"]
                if sid in poles and row.get("pickup_type") != "1":
                    t = parse_time(row.get("departure_time")) or parse_time(row.get("arrival_time"))
                    if t is not None:
                        cand.append((tid, seq, sid, t))

    groups = {}
    for sid, p in poles.items():
        g = groups.setdefault(p["group"], {"name": p["name"], "pts": [], "wd": 0, "hol": 0,
                                           "hourly": [0] * 24, "times": [], "routes": {}})
        g["pts"].append((p["lat"], p["lon"]))
    for tid, seq, sid, t in cand:
        if seq >= max_seq[tid]:
            continue  # 終点は発車しない
        g = groups[poles[sid]["group"]]
        ks = day_of[tid]
        if "wd" in ks:
            g["wd"] += 1
            g["hourly"][min(23, t // 3600)] += 1
            g["times"].append(t)
            rn = routes.get(trip_info[tid][1], {}).get("route_short_name", "")
            if rn:
                g["routes"][rn] = g["routes"].get(rn, 0) + 1
        if "hol" in ks:
            g["hol"] += 1
    out = []
    for gid, g in sorted(groups.items()):
        lat = sum(p[0] for p in g["pts"]) / len(g["pts"])
        lon = sum(p[1] for p in g["pts"]) / len(g["pts"])
        ts = g["times"]
        out.append({
            "id": gid, "name": g["name"], "lat": round(lat, 6), "lon": round(lon, 6),
            "wd": g["wd"], "hol": g["hol"],
            "first": hhmm(min(ts)) if ts else None, "last": hhmm(max(ts)) if ts else None,
            "hourly": g["hourly"],
            "routes": [k for k, _ in sorted(g["routes"].items(), key=lambda kv: (-kv[1], kv[0]))][:8],
        })
    meta = {"feed_start": str(start), "feed_end": str(end) if end else None,
            "ref_weekday": str(ref["wd"]), "ref_holiday": str(ref["hol"]),
            "feed_version": feed[0].get("feed_version") if feed else None}
    return out, meta


def nearest_m(lat, lon, items):
    return min((haversine_m(lat, lon, i["lat"], i["lon"]) for i in items), default=None)
