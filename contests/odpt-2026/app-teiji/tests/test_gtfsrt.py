import unittest

from helpers import APP  # noqa: F401  (sys.path 設定)
from teiji import gtfsrt


class TestGtfsRt(unittest.TestCase):
    def test_vehicle_roundtrip(self):
        b = gtfsrt.build_vehicle_feed(1700000000, [
            {"id": "V1", "trip_id": "T1", "route_id": "R1", "start_date": "20261118", "lat": 35.5, "lon": 139.25,
             "timestamp": 1699999990, "stop_sequence": 3, "stop_id": "S3"},
            {"id": "V2", "trip_id": "T2", "lat": 35.0, "lon": 139.0}])
        f = gtfsrt.parse_feed(b)
        self.assertEqual(f["timestamp"], 1700000000)
        self.assertEqual(f["n_entities"], 2)
        v = f["entities"][0]["vehicle"]
        self.assertEqual(v["trip"]["trip_id"], "T1")
        self.assertEqual(v["trip"]["start_date"], "20261118")
        self.assertEqual(v["vehicle"]["id"], "V1")
        self.assertAlmostEqual(v["position"]["lat"], 35.5, places=5)
        self.assertAlmostEqual(v["position"]["lon"], 139.25, places=5)
        self.assertEqual(v["timestamp"], 1699999990)
        self.assertEqual(v["current_stop_sequence"], 3)
        self.assertEqual(v["stop_id"], "S3")

    def test_trip_update_negative_delay(self):
        b = gtfsrt.build_trip_update_feed(1700000000, [
            {"trip_id": "T1", "start_date": "20261118", "stops": [
                {"stop_sequence": 1, "stop_id": "S1", "delay": -45}, {"stop_sequence": 2, "stop_id": "S2", "delay": 180, "time": 1700000500}]}])
        f = gtfsrt.parse_feed(b)
        tu = f["entities"][0]["trip_update"]
        self.assertEqual([s["arrival"]["delay"] for s in tu["stop_time_update"]], [-45, 180])
        self.assertEqual(tu["stop_time_update"][1]["arrival"]["time"], 1700000500)
        self.assertEqual(tu["trip"]["trip_id"], "T1")

    def test_empty_feed(self):
        f = gtfsrt.parse_feed(gtfsrt.build_vehicle_feed(1700000000, []))
        self.assertEqual(f["n_entities"], 0)
        self.assertEqual(f["timestamp"], 1700000000)
        self.assertEqual(gtfsrt.parse_feed(b"")["n_entities"], 0)

    def test_unknown_fields_skipped(self):
        extra = gtfsrt.enc_str(99, "x") + gtfsrt.enc_int(98, 5)
        b = gtfsrt.build_vehicle_feed(1700000000, [{"id": "V", "trip_id": "T", "lat": 1.0, "lon": 2.0}]) + extra
        self.assertEqual(gtfsrt.parse_feed(b)["n_entities"], 1)

    def test_truncated_raises(self):
        b = gtfsrt.build_vehicle_feed(1700000000, [{"id": "V", "trip_id": "T", "lat": 1.0, "lon": 2.0}])
        with self.assertRaises(ValueError):
            gtfsrt.parse_feed(b[:-3])
        with self.assertRaises(ValueError):
            gtfsrt.parse_feed(b"\x80")

    def test_html_error_page_raises(self):
        with self.assertRaises(ValueError):
            gtfsrt.parse_feed(b"<html><body>502 Bad Gateway</body></html>")


if __name__ == "__main__":
    unittest.main()
