"""テスト用の合成データ作成。"""
import csv
import io
import struct
import sys
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))


def csv_bytes(rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def make_feed_zip(stops, routes, trips, calendar, calendar_dates=(), feed_info=None):
    """stops [(id, name, lat, lon)], routes [(id, short, long)],
    trips [(trip_id, route_id, service_id, [(stop_id, 'H:MM:SS'), ...])]"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("stops.txt", csv_bytes([["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [list(s) for s in stops]))
        z.writestr("routes.txt", csv_bytes([["route_id", "route_short_name", "route_long_name", "route_type"]]
                                           + [[r[0], r[1], r[2], "3"] for r in routes]))
        z.writestr("trips.txt", csv_bytes([["route_id", "service_id", "trip_id", "direction_id"]]
                                          + [[t[1], t[2], t[0], "0"] for t in trips]))
        st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]
        for t in trips:
            for i, (sid, tm) in enumerate(t[3]):
                st.append([t[0], tm, tm, sid, i + 1])
        z.writestr("stop_times.txt", csv_bytes(st))
        z.writestr("calendar.txt", csv_bytes([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday",
                                               "saturday", "sunday", "start_date", "end_date"]] + [list(c) for c in calendar]))
        if calendar_dates:
            z.writestr("calendar_dates.txt", csv_bytes([["service_id", "date", "exception_type"]] + [list(c) for c in calendar_dates]))
        if feed_info:
            z.writestr("feed_info.txt", csv_bytes([["feed_version", "feed_start_date", "feed_end_date"], list(feed_info)]))
    return buf.getvalue()


def make_p12_zip(items):
    """国土数値情報 P12 風の zip（P12a: 点）。items [(name, kind, address, lon, lat)]"""
    fields = [("P12_001", 5), ("P12_002", 100), ("P12_003", 2), ("P12_004", 120), ("P12_005", 100), ("P12_006", 254), ("P12_007", 2)]
    rec_len = 1 + sum(w for _, w in fields)
    hdr_len = 32 + 32 * len(fields) + 1
    dbf = bytearray(struct.pack("<BBBBIHH20x", 3, 26, 1, 1, len(items), hdr_len, rec_len))
    for nm, w in fields:
        dbf += nm.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([w, 0]) + b"\0" * 14
    dbf += b"\r"
    for i, (name, kind, addr, lon, lat) in enumerate(items):
        vals = [str(i + 1), name, "13", "13106", kind, addr, "-1"]
        rec = b" "
        for (nm, w), v in zip(fields, vals):
            b = v.encode("cp932")
            rec += b.ljust(w, b" ")
        dbf += rec
    shp = bytearray(b"\0" * 100)
    shp[0:4] = struct.pack(">i", 9994)
    shp[32:36] = struct.pack("<i", 1)
    for i, (name, kind, addr, lon, lat) in enumerate(items):
        body = struct.pack("<i2d", 1, lon, lat)
        shp += struct.pack(">ii", i + 1, len(body) // 2) + body
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("P12a-14_13.dbf", bytes(dbf))
        z.writestr("P12a-14_13.shp", bytes(shp))
    return buf.getvalue()
