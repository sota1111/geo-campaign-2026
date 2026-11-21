"""テスト用の合成データ。"""
import csv
import io
import os
import sys
import zipfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP not in sys.path:
    sys.path.insert(0, APP)


def csv_bytes(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def make_gtfs(path):
    """水曜(2026-11-18)と日曜(2026-11-15)の運行を持つ小さな GTFS。
    便 t1・t3 は平日のみ、t2 は休日のみ。Z は範囲外のバス停。"""
    files = {
        "stops.txt": csv_bytes(
            ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"],
            [["P1", "駅前", "35.680", "139.780", "1", ""],
             ["P1-01", "駅前", "35.6800", "139.7800", "0", "P1"],
             ["P1-02", "駅前", "35.6802", "139.7802", "0", "P1"],
             ["B", "公園", "35.6850", "139.7800", "0", ""],
             ["C", "終点", "35.6900", "139.7800", "0", ""],
             ["Z", "圏外", "36.5", "140.5", "0", ""]]),
        "calendar.txt": csv_bytes(
            ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
            [["WD", 1, 1, 1, 1, 1, 0, 0, "20261115", "20291114"],
             ["HOL", 0, 0, 0, 0, 0, 0, 1, "20261115", "20291114"]]),
        "calendar_dates.txt": csv_bytes(["service_id", "date", "exception_type"], []),
        "feed_info.txt": csv_bytes(["feed_publisher_name", "feed_start_date", "feed_end_date", "feed_version"],
                                   [["x", "20261115", "20291114", "v1"]]),
        "routes.txt": csv_bytes(["route_id", "route_short_name"], [["R1", "都01"]]),
        "trips.txt": csv_bytes(["route_id", "service_id", "trip_id"],
                               [["R1", "WD", "t1"], ["R1", "WD", "t3"], ["R1", "HOL", "t2"], ["R1", "WD", "t4"]]),
        "stop_times.txt": csv_bytes(
            ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type"],
            [["t1", "08:00:00", "08:00:00", "P1-01", 1, ""],
             ["t1", "08:05:00", "08:05:00", "B", 2, ""],
             ["t1", "08:10:00", "08:10:00", "C", 3, ""],
             ["t3", "25:10:00", "25:10:00", "P1-02", 1, ""],
             ["t3", "25:20:00", "25:20:00", "B", 2, ""],
             ["t2", "10:00:00", "10:00:00", "P1-01", 1, ""],
             ["t2", "10:05:00", "10:05:00", "B", 2, ""],
             ["t4", "09:00:00", "09:00:00", "Z", 1, ""]]),
    }
    with zipfile.ZipFile(path, "w") as z:
        for n, b in files.items():
            z.writestr(n, b)
