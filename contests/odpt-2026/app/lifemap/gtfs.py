"""GTFS(-JP) フィードの読み込み。標準ライブラリのみ。

load_feed() は feed.zip を読み、基準日（平日=水曜・休日=日曜）に運行する便だけを
停留所列（時刻は秒、24時超を許容）に直して返す。
"""
import csv
import datetime as dt
import io
import zipfile

DAYTYPES = ("wd", "hol")  # 平日 / 休日
REF_WEEKDAY = {"wd": 2, "hol": 6}  # Monday=0: 水曜 / 日曜
DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def parse_time(s):
    """'H:MM:SS' -> 秒。空欄・不正は None。24時超を許す。"""
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


def active_services(calendar, calendar_dates, day: dt.date):
    """calendar と calendar_dates から、その日に運行する service_id の集合を返す。"""
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


def feed_validity(zf_rows_calendar, calendar_dates, feed_info):
    """(start, end) を feed_info → calendar → calendar_dates の順で求める。"""
    if feed_info:
        s, e = parse_date(feed_info[0].get("feed_start_date")), parse_date(feed_info[0].get("feed_end_date"))
        if s and e:
            return s, e
    starts = [parse_date(r.get("start_date")) for r in zf_rows_calendar]
    ends = [parse_date(r.get("end_date")) for r in zf_rows_calendar]
    starts += [parse_date(r.get("date")) for r in calendar_dates]
    ends += [parse_date(r.get("date")) for r in calendar_dates]
    starts = [x for x in starts if x]
    ends = [x for x in ends if x]
    if not starts or not ends:
        return None, None
    return min(starts), max(ends)


def pick_ref_date(today: dt.date, start, end, weekday: int):
    """today 以降で最初の指定曜日。フィード期間内に収まるように寄せる（期間外なら期間内の最寄り）。"""
    base = today
    if start and base < start:
        base = start
    d = base + dt.timedelta(days=(weekday - base.weekday()) % 7)
    if end and d > end:
        d = end - dt.timedelta(days=(end.weekday() - weekday) % 7)
    return d


def fill_times(seq):
    """seq=[[stop_id, arr, dep], ...]。欠損時刻を補う。補えない前後の欠損は捨てる。"""
    for rec in seq:
        if rec[1] is None:
            rec[1] = rec[2]
        if rec[2] is None:
            rec[2] = rec[1]
    known = [i for i, r in enumerate(seq) if r[1] is not None]
    if len(known) < 2:
        return []
    first, last = known[0], known[-1]
    seq = seq[first:last + 1]
    known = [i for i, r in enumerate(seq) if r[1] is not None]
    for a, b in zip(known, known[1:]):
        if b - a > 1:
            t0, t1 = seq[a][2], seq[b][1]
            for k in range(a + 1, b):
                t = t0 + (t1 - t0) * (k - a) // (b - a)
                seq[k][1] = seq[k][2] = t
    return seq


def load_feed(source, bbox, today: dt.date):
    """feed.zip（パスまたはバイト列）を読む。

    戻り値 dict:
      stops {sid: (lat, lon, name)}   bbox 内のみ
      routes {rid: (short, long, color)}
      trips [ {trip_id, route_id, dir, active:{wd,hol}, seq:[(sid, arr, dep)]} ]
      ref {wd: date, hol: date}, start, end
    """
    zf = zipfile.ZipFile(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source)
    lon0, lat0, lon1, lat1 = bbox
    stops = {}
    for r in read_csv(zf, "stops.txt"):
        try:
            lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
        except (KeyError, ValueError):
            continue
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            stops[r["stop_id"]] = (lat, lon, (r.get("stop_name") or "").strip())
    routes = {}
    for r in read_csv(zf, "routes.txt"):
        routes[r["route_id"]] = (
            (r.get("route_short_name") or "").strip(),
            (r.get("route_long_name") or "").strip(),
            (r.get("route_color") or "").strip(),
        )
    calendar = read_csv(zf, "calendar.txt")
    calendar_dates = read_csv(zf, "calendar_dates.txt")
    start, end = feed_validity(calendar, calendar_dates, read_csv(zf, "feed_info.txt"))
    ref = {k: pick_ref_date(today, start, end, REF_WEEKDAY[k]) for k in DAYTYPES}
    svc = {k: active_services(calendar, calendar_dates, ref[k]) for k in DAYTYPES}

    trips = {}
    for r in read_csv(zf, "trips.txt"):
        act = {k: r["service_id"] in svc[k] for k in DAYTYPES}
        if act["wd"] or act["hol"]:
            trips[r["trip_id"]] = {
                "trip_id": r["trip_id"],
                "route_id": r["route_id"],
                "dir": r.get("direction_id", ""),
                "active": act,
                "raw": [],
            }
    for r in read_csv(zf, "stop_times.txt"):
        t = trips.get(r["trip_id"])
        if t is None:
            continue
        try:
            seqno = int(r["stop_sequence"])
        except (KeyError, ValueError):
            continue
        t["raw"].append((seqno, r["stop_id"], parse_time(r.get("arrival_time")), parse_time(r.get("departure_time"))))
    out = []
    for t in trips.values():
        raw = sorted(t.pop("raw"), key=lambda x: x[0])
        seq = fill_times([[sid, a, d] for _, sid, a, d in raw])
        seq = [(sid, a, d) for sid, a, d in seq if sid in stops]
        if len(seq) < 2:
            continue
        t["seq"] = seq
        out.append(t)
    return {"stops": stops, "routes": routes, "trips": out, "ref": ref, "start": start, "end": end}
