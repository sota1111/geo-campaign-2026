"""人口メッシュ(e-Stat)・施設(国土数値情報)の読み込み。"""
import csv
import io
import json
import zipfile

# 国土数値情報 学校データ P29: 学校分類コード
SCHOOL_CODES = {16001: "小学校", 16002: "中学校"}
# 国土数値情報 医療機関データ P04: 1=病院, 2=診療所, 3=歯科診療所
HOSPITAL_CODE = 1


def mesh_bounds(code):
    """250m/500m メッシュコード文字列 -> (lat_min, lon_min, lat_max, lon_max)。

    9桁=500mメッシュ(末尾 1=南西,2=南東,3=北西,4=北東)。8桁=3次メッシュ(1km)。
    """
    p, q = int(code[0:2]), int(code[2:4])
    r, s = int(code[4]), int(code[5])
    t, u = int(code[6]), int(code[7])
    lat = p * 2 / 3 + r / 12 + t / 120
    lon = 100 + q + s / 8 + u / 80
    dlat, dlon = 1 / 120, 1 / 80
    if len(code) >= 9:
        m = int(code[8]) - 1
        dlat, dlon = dlat / 2, dlon / 2
        lat += (m // 2) * dlat
        lon += (m % 2) * dlon
    return lat, lon, lat + dlat, lon + dlon


def read_mesh_population(zip_path):
    """e-Stat T001102 の zip -> {9桁コード: [人口, 65歳以上人口]}（250mを500mに集約）。

    65歳以上は秘匿処理のため近隣メッシュへ合算されている場合がある（合算先に計上される）。
    '*' は 0 として扱う。
    """
    out = {}
    with zipfile.ZipFile(zip_path) as zf:
        name = zf.namelist()[0]
        text = io.TextIOWrapper(zf.open(name), "cp932", newline="")
        rd = csv.reader(text)
        next(rd)  # 英字ヘッダー
        next(rd)  # 日本語ヘッダー
        for row in rd:
            key = row[0]
            if len(key) != 10:
                continue
            code = key[:9]
            pop = int(row[4]) if row[4].isdigit() else 0
            p65 = int(row[22]) if len(row) > 22 and row[22].isdigit() else 0
            cur = out.setdefault(code, [0, 0])
            cur[0] += pop
            cur[1] += p65
    return out


def _read_geojson(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".geojson"))
        return json.loads(zf.read(name).decode("utf-8"))


def read_hospitals(zip_path, bbox):
    """P04: 病院(P04_001==1)のみ。[(lat, lon, name)]"""
    lon0, lat0, lon1, lat1 = bbox
    out = []
    for f in _read_geojson(zip_path)["features"]:
        p = f["properties"]
        if p.get("P04_001") != HOSPITAL_CODE:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            out.append((lat, lon, p.get("P04_002") or ""))
    return out


def read_schools(zip_path, bbox):
    """P29: 小学校・中学校のみ。[(lat, lon, name, 種別)]"""
    lon0, lat0, lon1, lat1 = bbox
    out = []
    for f in _read_geojson(zip_path)["features"]:
        p = f["properties"]
        kind = SCHOOL_CODES.get(p.get("P29_003"))
        if not kind:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            out.append((lat, lon, p.get("P29_004") or "", kind))
    return out


def read_rail_stations(zip_path, bbox):
    """国土数値情報 N02（鉄道データ）の駅。[(lat, lon, 駅名, 運営会社, 路線名)]

    駅は2点の線分なので中点を位置とする。UTF-8 版の Station.geojson を読む。
    """
    lon0, lat0, lon1, lat1 = bbox
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.startswith("UTF-8/") and n.endswith("_Station.geojson"))
        data = json.loads(zf.read(name).decode("utf-8"))
    out = []
    for f in data["features"]:
        p = f["properties"]
        g = f["geometry"]
        pts = g["coordinates"] if g["type"] == "LineString" else [g["coordinates"]]
        lon = sum(q[0] for q in pts) / len(pts)
        lat = sum(q[1] for q in pts) / len(pts)
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            out.append((lat, lon, p.get("N02_005") or "", p.get("N02_004") or "", p.get("N02_003") or ""))
    return out
