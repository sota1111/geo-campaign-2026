"""最小の COG（Cloud Optimized GeoTIFF）窓読み取り。標準ライブラリ＋numpy のみ。
HTTP の Range 付き GET で、必要なタイルだけを取得する（POST・認証なし）。
対応: タイル構成の GeoTIFF、非圧縮/Deflate(+水平予測子)、16bit/8bit 整数、リトルエンディアン。
Sentinel-2 L2A COG（AWS Open Data: sentinel-cogs）の最大解像度（IFD 0）を読む用途に限定。
"""
import struct
import urllib.request
import zlib
import numpy as np

UA = {"User-Agent": "geo-campaign-demo/0.1 (satellite-2026 proposal-yabu; read-only GET)"}
TYPES = {1: ("B", 1), 2: ("c", 1), 3: ("H", 2), 4: ("I", 4), 5: ("II", 8), 11: ("f", 4), 12: ("d", 8), 16: ("Q", 8)}


def http_range(url, start, length):
    req = urllib.request.Request(url, headers=dict(UA, Range="bytes=%d-%d" % (start, start + length - 1)))
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


class Cog:
    def __init__(self, url):
        self.url = url
        head = http_range(url, 0, 262144)
        if head[:2] != b"II" or struct.unpack("<H", head[2:4])[0] != 42:
            raise ValueError("リトルエンディアンの通常 TIFF のみ対応")
        ifd = struct.unpack("<I", head[4:8])[0]
        n = struct.unpack("<H", head[ifd:ifd + 2])[0]
        tags = {}
        for i in range(n):
            tag, typ, cnt, val = struct.unpack("<HHI4s", head[ifd + 2 + 12 * i: ifd + 14 + 12 * i])
            fmt, size = TYPES[typ]
            total = size * cnt
            if total <= 4:
                raw = val[:total]
            else:
                off = struct.unpack("<I", val)[0]
                raw = head[off: off + total]
                if len(raw) < total:
                    raw = http_range(url, off, total)
            if typ in (3, 4, 16):
                tags[tag] = struct.unpack("<%d%s" % (cnt, fmt), raw)
            elif typ == 12:
                tags[tag] = struct.unpack("<%dd" % cnt, raw)
            else:
                tags[tag] = raw
        self.w, self.h = tags[256][0], tags[257][0]
        self.bits = tags[258][0]
        self.comp = tags[259][0]
        self.pred = tags.get(317, (1,))[0]
        self.tw, self.th = tags[322][0], tags[323][0]
        self.offsets, self.counts = tags[324], tags[325]
        self.scale = tags[33550][:2]           # ModelPixelScale
        self.tie = tags[33922][:6]             # ModelTiepoint (i,j,k,x,y,z)
        self.dtype = np.dtype("<u2") if self.bits == 16 else np.dtype("u1")
        if self.comp not in (1, 8, 32946):
            raise ValueError("未対応の圧縮 %d" % self.comp)
        self.across = -(-self.w // self.tw)

    def xy_to_px(self, x, y):
        return (x - self.tie[3]) / self.scale[0], (self.tie[4] - y) / self.scale[1]

    def tile(self, tx, ty):
        i = ty * self.across + tx
        raw = http_range(self.url, self.offsets[i], self.counts[i])
        if self.comp in (8, 32946):
            raw = zlib.decompress(raw)
        a = np.frombuffer(raw, dtype=self.dtype).reshape(self.th, self.tw).copy()
        if self.pred == 2:
            a = np.cumsum(a, axis=1, dtype=self.dtype)
        return a

    def window(self, x0, y0, x1, y1):
        """UTM 座標の矩形（西・北・東・南）→ 配列。範囲外は 0。戻り値 (配列, 左上x, 左上y)。"""
        c0, r0 = self.xy_to_px(x0, y0)
        c1, r1 = self.xy_to_px(x1, y1)
        c0, r0, c1, r1 = int(np.floor(c0)), int(np.floor(r0)), int(np.ceil(c1)), int(np.ceil(r1))
        out = np.zeros((r1 - r0, c1 - c0), dtype=self.dtype)
        for ty in range(max(0, r0) // self.th, min(self.h - 1, r1 - 1) // self.th + 1):
            for tx in range(max(0, c0) // self.tw, min(self.w - 1, c1 - 1) // self.tw + 1):
                t = self.tile(tx, ty)
                cs, rs = tx * self.tw, ty * self.th
                a0, a1 = max(c0, cs), min(c1, cs + self.tw)
                b0, b1 = max(r0, rs), min(r1, rs + self.th)
                out[b0 - r0:b1 - r0, a0 - c0:a1 - c0] = t[b0 - rs:b1 - rs, a0 - cs:a1 - cs]
        return out, self.tie[3] + c0 * self.scale[0], self.tie[4] - r0 * self.scale[1]
