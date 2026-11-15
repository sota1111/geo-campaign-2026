"""地理の小さな関数。標準ライブラリのみ。"""
import math

R_EARTH = 6371008.8


def haversine_m(lat1, lon1, lat2, lon2):
    """2点間の直線距離（m）。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def lonlat_to_tile_px(lon, lat, z, size=256):
    """経緯度 -> (タイルx, タイルy, タイル内の画素x, 画素y)。Web メルカトル（XYZ）。"""
    n = 2 ** z
    fx = (lon + 180.0) / 360.0 * n
    fy = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    tx, ty = int(math.floor(fx)), int(math.floor(fy))
    px = min(size - 1, int((fx - tx) * size))
    py = min(size - 1, int((fy - ty) * size))
    return tx, ty, px, py
