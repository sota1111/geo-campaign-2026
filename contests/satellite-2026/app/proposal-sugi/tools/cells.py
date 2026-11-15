"""評価単位（区画）の作り方。区画 = 500mメッシュ（地域メッシュ 4次メッシュ、9桁コード）× スギ植林。
植生図のスギ植林ポリゴンは山地で非常に大きく連なるため、順位付けの単位としては 500m メッシュで区切る。
shapely / pyproj が必要（tools/requirements.txt）。
"""
import json
import math

import shapely
from pyproj import Transformer
from shapely.geometry import box, shape
from shapely.ops import transform

BBOX = (139.17, 35.76, 139.35, 35.88)  # lon_min, lat_min, lon_max, lat_max
TO_UTM = Transformer.from_crs(4326, 32654, always_xy=True).transform  # 王子付近は UTM 54N（Sentinel-2 の座標系）


def mesh500_bounds(code):
    """9桁（4次メッシュ=500m）コード → (lon_min, lat_min, lon_max, lat_max)。"""
    p, u, q, v, r, w, m = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7]), int(code[8])
    lat = p * 40 / 60 + q * 5 / 60 + r * 30 / 3600 + (m in (3, 4)) * 15 / 3600
    lon = 100 + u + v * 7.5 / 60 + w * 45 / 3600 + (m in (2, 4)) * 22.5 / 3600
    return lon, lat, lon + 22.5 / 3600, lat + 15 / 3600


def mesh500_code(lat, lon):
    p = int(lat * 1.5); a = lat * 1.5 - p
    u = int(lon - 100); b = lon - 100 - u
    q = int(a * 8); a = a * 8 - q
    v = int(b * 8); b = b * 8 - v
    r = int(a * 10); a = a * 10 - r
    w = int(b * 10); b = b * 10 - w
    m = (2 if a >= 0.5 else 0) + (1 if b >= 0.5 else 0) + 1
    # 4次メッシュ: 1=南西, 2=南東, 3=北西, 4=北東
    return '%02d%02d%d%d%d%d%d' % (p, u, q, v, r, w, m)


def load_sugi(path):
    """veg_raw.json → [(shapely 形状(lon/lat, 有効化済み), 群落名)]"""
    out = []
    for f in json.load(open(path, encoding='utf-8'))['features']:
        g = shapely.make_valid(shape(f['geometry']))
        out.append((g, f['properties'].get('凡例名')))
    return out


def build_cells(sugi, min_ha=0.5):
    """スギ植林 ∩ 500mメッシュ。戻り値 {コード: {'geom_ll': 形状, 'geom_utm': 形状, 'ha': 面積(ha)}}。"""
    lon0, lat0, lon1, lat1 = BBOX
    cells = {}
    merged = shapely.union_all([g for g, _ in sugi])
    # 対象範囲内のメッシュを走査（中心が BBOX 内のもの）
    dlat, dlon = 15 / 3600, 22.5 / 3600
    lat = lat0
    while lat < lat1:
        lon = lon0
        while lon < lon1:
            code = mesh500_code(lat + dlat / 2, lon + dlon / 2)
            b = mesh500_bounds(code)
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            if lon0 <= cx <= lon1 and lat0 <= cy <= lat1 and code not in cells:
                part = merged.intersection(box(*b))
                if not part.is_empty and part.area > 0:
                    gu = transform(TO_UTM, part)
                    ha = gu.area / 1e4
                    if ha >= min_ha:  # 縁にかかるわずかな破片は除く
                        cells[code] = {'geom_ll': part, 'geom_utm': gu, 'ha': ha, 'center': (cy, cx)}
            lon += dlon
        lat += dlat
    return cells


def mesh_area_ha(code):
    b = mesh500_bounds(code)
    return transform(TO_UTM, box(*b)).area / 1e4
