"""GSI 干渉SAR タイル（qu）の色を凡例の16階級に戻し、約90m の格子（区画）ごとに階級の中央値を出す。
値は「階級」としてのみ扱う（1階級 = 3.75 mm/年幅。凡例 -3〜+3 cm/年 を16等分）。"""
import math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
Z = 15
N_CLASS = 16
CLASS_W = 6.0 / N_CLASS * 10  # mm/年（= 3.75）
CELL_M = 90.0
MAX_COLOR_DIST = 40  # 凡例色からのRGB距離。これを超える画素は「階級に戻せない」として捨てる


def legend_colors():
    im = np.array(Image.open(os.path.join(CACHE, 'legend_qu.png')).convert('RGB'))
    y = 220  # 色帯の中央付近
    row = im[y]
    # 色帯は x=137..1301 の16等分
    x0, x1 = 137, 1301
    return np.array([row[int(x0 + (x1 - x0) * (i + 0.5) / N_CLASS)] for i in range(N_CLASS)], dtype=float)


def class_mid(k):
    """階級 k(0=最も沈下) の中央値 mm/年。範囲は -30 + 3.75*k 〜 +3.75。"""
    return -30.0 + CLASS_W * (k + 0.5)


def class_range(k):
    return (-30.0 + CLASS_W * k, -30.0 + CLASS_W * (k + 1))


def tile_xy(lon, lat, z=Z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def lonlat_of_tile_xy(x, y, z=Z):
    n = 2 ** z
    return x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


def load_class_mosaic(bbox, layer='qu'):
    """bbox=(w,s,e,n) を覆うタイルを読み、(階級配列[-1=なし], 左上のタイル座標) を返す。"""
    w, s, e, n = bbox
    fx0, fy1 = tile_xy(w, s); fx1, fy0 = tile_xy(e, n)
    tx0, tx1, ty0, ty1 = math.floor(fx0), math.floor(fx1), math.floor(fy0), math.floor(fy1)
    leg = legend_colors()
    H, W = (ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256
    cls = np.full((H, W), -1, dtype=np.int8)
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            p = os.path.join(CACHE, f'{layer}_{Z}_{tx}_{ty}.png')
            if not os.path.exists(p):
                continue
            im = np.array(Image.open(p).convert('RGBA')).astype(float)
            rgb, a = im[..., :3], im[..., 3]
            d = np.sqrt(((rgb[:, :, None, :] - leg[None, None, :, :]) ** 2).sum(-1))
            k = d.argmin(-1).astype(np.int8)
            ok = (d.min(-1) <= MAX_COLOR_DIST) & (a > 128)
            k[~ok] = -1
            cls[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = k
    return cls, (tx0, ty0)


def grid_cells(cls, origin, bbox, lat0):
    """約90m の緯度経度格子。各格子の有効画素の階級の中央値（整数階級）と有効画素数を返す。"""
    w, s, e, n = bbox
    dlat = CELL_M / 110574.0
    dlon = CELL_M / (111320.0 * math.cos(math.radians(lat0)))
    tx0, ty0 = origin
    ncols = int((e - w) / dlon) + 1
    nrows = int((n - s) / dlat) + 1
    cells = []
    for r in range(nrows):
        for c in range(ncols):
            lo0, la0 = w + c * dlon, s + r * dlat
            xa, ya = tile_xy(lo0, la0 + dlat)  # 左上
            xb, yb = tile_xy(lo0 + dlon, la0)  # 右下
            px0, py0 = int((xa - tx0) * 256), int((ya - ty0) * 256)
            px1, py1 = max(px0 + 1, int((xb - tx0) * 256)), max(py0 + 1, int((yb - ty0) * 256))
            if px0 < 0 or py0 < 0 or px1 > cls.shape[1] or py1 > cls.shape[0]:
                continue
            blk = cls[py0:py1, px0:px1].ravel()
            tot = blk.size
            v = blk[blk >= 0]
            if tot == 0 or v.size < 0.5 * tot:
                continue  # 有効画素が半分未満の区画は衛星データなし
            cells.append({'r': r, 'c': c, 'lon0': lo0, 'lat0': la0, 'dlon': dlon, 'dlat': dlat,
                          'k': int(np.sort(v)[(v.size - 1) // 2]), 'valid': float(v.size / tot)})
    return cells
