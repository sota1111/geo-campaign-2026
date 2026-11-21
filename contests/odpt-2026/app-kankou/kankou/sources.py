"""観光資源・施設（国土数値情報）の読み込み。標準ライブラリのみ。

- 観光資源 P12-14（平成26年度版）: shp + dbf（Shift_JIS）を自前で読む。点・多点はその座標、線・面は外接矩形の中心。
- 医療機関 P04-20（病院のみ）・学校 P29-21（小学校・中学校・中等教育学校・高等学校）・鉄道駅 N02-22（駅）。app/lifemap/sources.py を元にした。
"""
import json
import struct
import zipfile

SCHOOL_CODES = {16001: "小学校", 16002: "中学校", 16003: "中学校", 16004: "高校"}  # 16003 中等教育学校は中学校に含める
HOSPITAL_CODE = 1


def _read_dbf(data):
    n, header_len, rec_len = struct.unpack("<xxxxIHH", data[:12])
    fields, o = [], 32
    while data[o] != 13:
        fields.append((data[o:o + 11].split(b"\0")[0].decode("ascii"), data[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        rec = data[header_len + i * rec_len: header_len + (i + 1) * rec_len]
        p, row = 1, {}
        for name, ln in fields:
            row[name] = rec[p:p + ln].decode("cp932", "replace").strip()
            p += ln
        rows.append(row)
    return rows


def _read_shp_centers(data):
    """各レコードの代表点 [(lon, lat)]。Null shape は (None, None)。"""
    out, o = [], 100
    while o + 8 <= len(data):
        clen = struct.unpack(">i", data[o + 4:o + 8])[0] * 2
        body = data[o + 8:o + 8 + clen]
        st = struct.unpack("<i", body[:4])[0] if len(body) >= 4 else 0
        if st == 1:
            out.append(struct.unpack("<2d", body[4:20]))
        elif st in (3, 5, 8, 13, 15, 18, 23, 25, 28):
            x0, y0, x1, y1 = struct.unpack("<4d", body[4:36])
            out.append(((x0 + x1) / 2, (y0 + y1) / 2))
        else:
            out.append((None, None))
        o += 8 + clen
    return out


EVENT_KINDS = ("芸能・興行・イベント", "年中行事")


def _locatable(row):
    """代表点が地点を表すものだけ使う。複数区にまたがる項目（「および」区切り）と、番地のないイベントは除く。"""
    addr = row.get("P12_006", "")
    if "および" in addr:
        return False
    if row.get("P12_005", "") in EVENT_KINDS and not any(c.isdigit() for c in addr):
        return False
    return True


def read_tourist_spots(zip_path, bbox):
    """P12-14 の観光資源。[{name, kind, lat, lon}]。bbox=[lon0, lat0, lon1, lat1]。

    同じ座標の項目（例: 浅草寺と三社祭）は1地点にまとめ、名称を「・」でつなぐ。
    """
    lon0, lat0, lon1, lat1 = bbox
    spots = {}
    with zipfile.ZipFile(zip_path) as zf:
        stems = sorted({n[:-4] for n in zf.namelist() if n.startswith("P12") and n.endswith(".shp")})
        for stem in stems:
            rows = _read_dbf(zf.read(stem + ".dbf"))
            cen = _read_shp_centers(zf.read(stem + ".shp"))
            for r, (x, y) in zip(rows, cen):
                if x is None or not (lon0 <= x <= lon1 and lat0 <= y <= lat1):
                    continue
                key = (round(y, 4), round(x, 4))
                name = r.get("P12_002", "")
                kind = r.get("P12_005", "")
                if not _locatable(r):
                    continue
                s = spots.setdefault(key, {"names": [], "kind": kind, "lat": round(y, 5), "lon": round(x, 5)})
                if name and name not in s["names"]:
                    s["names"].append(name)
    out = [{"name": "・".join(s["names"]), "kind": s["kind"] if s["kind"] != "‐" else "", "lat": s["lat"], "lon": s["lon"]}
           for s in spots.values() if s["names"]]
    out.sort(key=lambda s: (s["lat"], s["lon"]))
    return out


def _read_geojson(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".geojson"))
        return json.loads(zf.read(name).decode("utf-8"))


def read_hospitals(zip_path, bbox):
    lon0, lat0, lon1, lat1 = bbox
    out = []
    for f in _read_geojson(zip_path)["features"]:
        p = f["properties"]
        if p.get("P04_001") != HOSPITAL_CODE:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            out.append({"name": p.get("P04_002") or "", "kind": "病院", "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def read_schools(zip_path, bbox):
    lon0, lat0, lon1, lat1 = bbox
    out = []
    for f in _read_geojson(zip_path)["features"]:
        p = f["properties"]
        kind = SCHOOL_CODES.get(p.get("P29_003"))
        if not kind:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            out.append({"name": p.get("P29_004") or "", "kind": kind, "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def read_rail_stations(zip_path, bbox):
    """N02 の駅（2点の線分の中点）。同名・同事業者・同路線の重複は除く。"""
    lon0, lat0, lon1, lat1 = bbox
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.startswith("UTF-8/") and n.endswith("_Station.geojson"))
        data = json.loads(zf.read(name).decode("utf-8"))
    out, seen = [], set()
    for f in data["features"]:
        p = f["properties"]
        g = f["geometry"]
        pts = g["coordinates"] if g["type"] == "LineString" else [g["coordinates"]]
        lon = sum(q[0] for q in pts) / len(pts)
        lat = sum(q[1] for q in pts) / len(pts)
        if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
            continue
        nm, op, line = p.get("N02_005") or "", p.get("N02_004") or "", p.get("N02_003") or ""
        if (nm, op, line) in seen:
            continue
        seen.add((nm, op, line))
        out.append({"name": f"{nm}駅（{op}・{line}）", "kind": "鉄道駅", "lat": round(lat, 5), "lon": round(lon, 5), "op": op, "line": line})
    return out
