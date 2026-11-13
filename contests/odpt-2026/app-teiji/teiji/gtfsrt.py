"""GTFS Realtime（Protocol Buffers）を標準ライブラリだけで読む。

対応: FeedMessage の header / entity（vehicle = VehiclePosition、trip_update = TripUpdate）。
知らないフィールドは読み飛ばす。壊れたデータは ValueError。
仕様: https://gtfs.org/documentation/realtime/proto/
"""
import struct


def _varint(b, i):
    shift = result = 0
    while True:
        if i >= len(b):
            raise ValueError("varint が途中で終わっている")
        c = b[i]
        i += 1
        result |= (c & 0x7F) << shift
        if not c & 0x80:
            return result, i
        shift += 7
        if shift > 70:
            raise ValueError("varint が長すぎる")


def fields(b):
    """メッセージ本体を [(番号, ワイヤ種別, 値)] に分解する。長さ区切りの値は bytes、固定長は bytes、varint は int。"""
    i, out = 0, []
    n = len(b)
    while i < n:
        key, i = _varint(b, i)
        num, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(b, i)
        elif wt == 1:
            v, i = b[i:i + 8], i + 8
        elif wt == 2:
            ln, i = _varint(b, i)
            v, i = b[i:i + ln], i + ln
            if len(v) != ln:
                raise ValueError("長さ区切りの値が途中で切れている")
        elif wt == 5:
            v, i = b[i:i + 4], i + 4
        else:
            raise ValueError(f"未対応のワイヤ種別 {wt}")
        if wt in (1, 5) and len(v) != (8 if wt == 1 else 4):
            raise ValueError("固定長の値が途中で切れている")
        out.append((num, wt, v))
    return out


def _s32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v >= 1 << 31 else v


def _s64(v):
    return v - (1 << 64) if v >= 1 << 63 else v


def _str(v):
    return v.decode("utf-8", "replace")


def _f32(v):
    return struct.unpack("<f", v)[0]


def _first(fs, num):
    for n, _, v in fs:
        if n == num:
            return v
    return None


def parse_trip(b):
    t = {}
    for n, wt, v in fields(b):
        if n == 1:
            t["trip_id"] = _str(v)
        elif n == 2:
            t["start_time"] = _str(v)
        elif n == 3:
            t["start_date"] = _str(v)
        elif n == 4:
            t["schedule_relationship"] = v
        elif n == 5:
            t["route_id"] = _str(v)
        elif n == 6:
            t["direction_id"] = v
    return t


def parse_vehicle_descriptor(b):
    d = {}
    for n, wt, v in fields(b):
        if n == 1:
            d["id"] = _str(v)
        elif n == 2:
            d["label"] = _str(v)
    return d


def parse_position(b):
    p = {}
    for n, wt, v in fields(b):
        if n == 1:
            p["lat"] = _f32(v)
        elif n == 2:
            p["lon"] = _f32(v)
        elif n == 3:
            p["bearing"] = _f32(v)
        elif n == 5:
            p["speed"] = _f32(v)
    return p


def parse_vehicle_position(b):
    r = {}
    for n, wt, v in fields(b):
        if n == 1:
            r["trip"] = parse_trip(v)
        elif n == 2:
            r["position"] = parse_position(v)
        elif n == 3:
            r["current_stop_sequence"] = v
        elif n == 4:
            r["current_status"] = v
        elif n == 5:
            r["timestamp"] = v
        elif n == 7:
            r["stop_id"] = _str(v)
        elif n == 8:
            r["vehicle"] = parse_vehicle_descriptor(v)
    return r


def parse_stop_time_event(b):
    e = {}
    for n, wt, v in fields(b):
        if n == 1:
            e["delay"] = _s32(v)
        elif n == 2:
            e["time"] = _s64(v)
    return e


def parse_stop_time_update(b):
    u = {}
    for n, wt, v in fields(b):
        if n == 1:
            u["stop_sequence"] = v
        elif n == 2:
            u["arrival"] = parse_stop_time_event(v)
        elif n == 3:
            u["departure"] = parse_stop_time_event(v)
        elif n == 4:
            u["stop_id"] = _str(v)
        elif n == 5:
            u["schedule_relationship"] = v
    return u


def parse_trip_update(b):
    r = {"stop_time_update": []}
    for n, wt, v in fields(b):
        if n == 1:
            r["trip"] = parse_trip(v)
        elif n == 2:
            r["stop_time_update"].append(parse_stop_time_update(v))
        elif n == 3:
            r["vehicle"] = parse_vehicle_descriptor(v)
        elif n == 4:
            r["timestamp"] = v
        elif n == 5:
            r["delay"] = _s32(v)
    return r


def parse_feed(b):
    """FeedMessage -> {"timestamp": 秒, "entities": [{"id", "vehicle"?, "trip_update"?}], "n_entities": 件数}。"""
    out = {"timestamp": None, "entities": []}
    for n, wt, v in fields(b):
        if n == 1 and wt == 2:
            for hn, hwt, hv in fields(v):
                if hn == 3:
                    out["timestamp"] = hv
        elif n == 2 and wt == 2:
            ent = {}
            for en, ewt, ev in fields(v):
                if en == 1:
                    ent["id"] = _str(ev)
                elif en == 3:
                    ent["trip_update"] = parse_trip_update(ev)
                elif en == 4:
                    ent["vehicle"] = parse_vehicle_position(ev)
            out["entities"].append(ent)
    out["n_entities"] = len(out["entities"])
    return out


# ---- 書き出し（テスト用の合成データ作成にも使う） ----
def _enc_varint(x):
    if x < 0:
        x += 1 << 64
    out = bytearray()
    while True:
        c = x & 0x7F
        x >>= 7
        if x:
            out.append(c | 0x80)
        else:
            out.append(c)
            return bytes(out)


def _tag(num, wt):
    return _enc_varint(num << 3 | wt)


def enc_bytes(num, b):
    return _tag(num, 2) + _enc_varint(len(b)) + b


def enc_str(num, s):
    return enc_bytes(num, s.encode("utf-8"))


def enc_int(num, x):
    return _tag(num, 0) + _enc_varint(x)


def enc_f32(num, x):
    return _tag(num, 5) + struct.pack("<f", x)


def build_vehicle_feed(timestamp, vehicles):
    """vehicles: [{"id","trip_id","route_id","start_date","lat","lon","timestamp","stop_sequence"?,"stop_id"?}]"""
    msg = enc_bytes(1, enc_str(1, "2.0") + enc_int(3, timestamp))
    for k, v in enumerate(vehicles):
        trip = enc_str(1, v["trip_id"])
        if v.get("start_date"):
            trip += enc_str(3, v["start_date"])
        if v.get("route_id"):
            trip += enc_str(5, v["route_id"])
        vp = enc_bytes(1, trip) + enc_bytes(2, enc_f32(1, v["lat"]) + enc_f32(2, v["lon"]))
        if v.get("stop_sequence") is not None:
            vp += enc_int(3, v["stop_sequence"])
        vp += enc_int(5, v.get("timestamp", timestamp))
        if v.get("stop_id"):
            vp += enc_str(7, v["stop_id"])
        vp += enc_bytes(8, enc_str(1, v["id"]))
        msg += enc_bytes(2, enc_str(1, str(k)) + enc_bytes(4, vp))
    return msg


def build_trip_update_feed(timestamp, updates):
    """updates: [{"trip_id","route_id","start_date","stops":[{"stop_sequence","stop_id","delay","time"}]}]"""
    msg = enc_bytes(1, enc_str(1, "2.0") + enc_int(3, timestamp))
    for k, u in enumerate(updates):
        trip = enc_str(1, u["trip_id"]) + (enc_str(3, u["start_date"]) if u.get("start_date") else b"") \
            + (enc_str(5, u["route_id"]) if u.get("route_id") else b"")
        tu = enc_bytes(1, trip)
        for s in u["stops"]:
            ev = b""
            if s.get("delay") is not None:
                ev += enc_int(1, s["delay"])
            if s.get("time") is not None:
                ev += enc_int(2, s["time"])
            su = enc_int(1, s["stop_sequence"]) + enc_bytes(2, ev) + enc_str(4, s.get("stop_id", ""))
            tu += enc_bytes(2, su)
        tu += enc_int(4, timestamp)
        msg += enc_bytes(2, enc_str(1, str(k)) + enc_bytes(3, tu))
    return msg
