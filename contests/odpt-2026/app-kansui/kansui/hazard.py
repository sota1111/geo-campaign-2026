"""浸水想定の区分を、国土地理院「重ねるハザードマップ」のタイル画像の色から読み取る。

タイル（GET のみ・トークン不要）:
  洪水浸水想定区域（想定最大規模） https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png
  高潮浸水想定区域（想定最大規模） https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png
色と浸水深の対応は、同サイトの凡例画像（opendata.html の shinsui_legend3.png）から読み取った。
タイルが無い（HTTP 404）か、色が無い（透明）画素は「着色なし」(区分0)とする。
着色なしは「想定区域外」とは限らない（図面が未公表・未提供の河川・海岸も含む）。
"""
import io
import os
import time
import urllib.error
import urllib.request

from .geo import lonlat_to_tile_px

LAYERS = {
    "flood": "01_flood_l2_shinsuishin_data",
    "tide": "03_hightide_l2_shinsuishin_data",
}
URL = "https://disaportaldata.gsi.go.jp/raster/{layer}/{z}/{x}/{y}.png"
UA = {"User-Agent": "kansui-eki-map/0.1 (research; GET only)"}
ZOOM = 17  # 提供ズーム 2〜17 の最大。1画素は約1m。

# 区分（0 は着色なし）。ラベルは凡例の表記。
CLASS_LABELS = ["着色なし", "0.5m未満", "0.5〜3m", "3〜5m", "5〜10m", "10〜20m", "20m以上"]

# タイルの色 -> 区分。(248,225,166) は凡例で 0.5〜1m の小区分、(255,255,179) は 0.1〜0.3m の小区分。
COLOR_CLASS = {
    (247, 245, 169): 1,
    (255, 255, 179): 1,
    (255, 216, 192): 2,
    (248, 225, 166): 2,
    (255, 183, 183): 3,
    (255, 145, 145): 4,
    (242, 133, 201): 5,
    (220, 122, 220): 6,
}
TOLERANCE = 6  # 色の各成分のずれの許容（圧縮などの揺れ対策）


def classify_color(rgb):
    """(r,g,b) -> 区分 1〜6。凡例に無い色は 0。"""
    c = COLOR_CLASS.get(tuple(rgb))
    if c is not None:
        return c
    for key, v in COLOR_CLASS.items():
        if all(abs(a - b) <= TOLERANCE for a, b in zip(key, rgb)):
            return v
    return 0


def decode_tile(png_bytes):
    """PNG -> 256x256 の区分の行列（list of list）。Pillow が必要。"""
    from PIL import Image  # 遅延 import（ビルド時のみ必要）

    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    w, h = im.size
    px = im.load()
    cls = {}
    out = []
    for y in range(h):
        row = []
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                row.append(0)
            else:
                k = (r, g, b)
                if k not in cls:
                    cls[k] = classify_color(k)
                row.append(cls[k])
        out.append(row)
    return out


def fetch_tile(layer, z, x, y, cache_dir=None, delay=0.05, opener=None):
    """タイルの PNG バイト列。無ければ None（404）。cache_dir にキャッシュする。"""
    path = None
    if cache_dir:
        path = os.path.join(cache_dir, layer, str(z), str(x), f"{y}.png")
        if os.path.exists(path):
            b = open(path, "rb").read()
            return b or None  # 空ファイルは 404 の記録
    url = URL.format(layer=layer, z=z, x=x, y=y)
    try:
        if opener:
            b = opener(url)
        else:
            time.sleep(delay)
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        b = b""
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(b)
    return b or None


class Sampler:
    """地点の区分を返す。周囲 radius 画素（既定1＝3x3、約±1m）の最大値を取る。"""

    def __init__(self, cache_dir=None, z=ZOOM, radius=1, fetcher=None):
        self.cache_dir = cache_dir
        self.z = z
        self.radius = radius
        self.fetcher = fetcher or (lambda layer, z, x, y: fetch_tile(layer, z, x, y, cache_dir))
        self._tiles = {}

    def _tile(self, layer, x, y):
        k = (layer, x, y)
        if k not in self._tiles:
            b = self.fetcher(layer, self.z, x, y)
            self._tiles[k] = decode_tile(b) if b else None
        return self._tiles[k]

    def level(self, layer, lon, lat):
        tx, ty, px, py = lonlat_to_tile_px(lon, lat, self.z)
        best = 0
        r = self.radius
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                x, y = px + dx, py + dy
                tdx, tdy = tx, ty
                if x < 0:
                    tdx, x = tx - 1, x + 256
                elif x > 255:
                    tdx, x = tx + 1, x - 256
                if y < 0:
                    tdy, y = ty - 1, y + 256
                elif y > 255:
                    tdy, y = ty + 1, y - 256
                t = self._tile(layer, tdx, tdy)
                if t is not None:
                    best = max(best, t[y][x])
        return best

    def __call__(self, lon, lat):
        return {k: self.level(v, lon, lat) for k, v in LAYERS.items()}
