#!/usr/bin/env python3
"""Meta・WRI の高解像度樹高マップ（AWS Open Data、CC BY 4.0）から、指定地点まわりの小窓を取り出し data/real.js を作る。

python3 -I tools/build_real.py <lon> <lat> <出力 data/real.js> --acq <撮影日> [--png preview.png]
  撮影日は tools/acq_date.py で調べた値（この窓では 2020-02-09）

- 取得は HTTP GET（Range 指定）のみ。タイル全体（約317MB）は取らず、窓に必要な行（1行=1ストリップ）だけを読む。
- タイル 133002112（東京周辺、Web メルカトル、約1.19m/画素、8bit=樹高m）を対象にしている。
- 窓の約2.9km四方を 12 画素（約14mメルカトル）ごとに、90パーセンタイルの樹高(m)へ集約して格納する。
- numpy と Pillow（プレビュー用のみ）が必要。
"""
import json
import math
import struct
import sys
import urllib.request
import zlib

import numpy as np

TILE = "133002112"
URL = f"https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{TILE}.tif"
ORIGIN_X, ORIGIN_Y, RES = 15497760.358876055, 4304933.433021128, 1.1943285669558747  # GeoTIFF の tiepoint / scale
SIZE = 65536
WIN = 2400   # 画素
BLOCK = 12   # 画素 → 1セル


def get(rng):
    req = urllib.request.Request(URL, headers={"Range": f"bytes={rng[0]}-{rng[1]}", "User-Agent": "geo-campaign-2026"})
    return urllib.request.urlopen(req, timeout=120).read()


def merc(lon, lat):
    x = lon * 20037508.342789244 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * 20037508.342789244 / 180
    return x, y


def main():
    lon, lat, out = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
    acq = sys.argv[sys.argv.index("--acq") + 1]
    png = sys.argv[sys.argv.index("--png") + 1] if "--png" in sys.argv else None
    mx, my = merc(lon, lat)
    c0 = int((mx - ORIGIN_X) / RES) - WIN // 2
    r0 = int((ORIGIN_Y - my) / RES) - WIN // 2
    assert 0 <= c0 and c0 + WIN <= SIZE and 0 <= r0 and r0 + WIN <= SIZE
    meta_off = get((524660, 524660 + SIZE * 8 - 1))
    meta_cnt = get((372, 372 + SIZE * 8 - 1))
    offs = np.frombuffer(meta_off, dtype="<u8")
    cnts = np.frombuffer(meta_cnt, dtype="<u8")
    a = int(offs[r0]); b = int(offs[r0 + WIN - 1] + cnts[r0 + WIN - 1])
    print(f"行 {r0}〜{r0 + WIN - 1}、{(b - a) / 1e6:.1f} MB を取得")
    blob = get((a, b - 1))
    img = np.zeros((WIN, WIN), dtype=np.uint8)
    for i in range(WIN):
        s = int(offs[r0 + i]) - a
        row = np.frombuffer(zlib.decompress(blob[s:s + int(cnts[r0 + i])]), dtype=np.uint8)
        row = np.cumsum(row, dtype=np.uint8)  # 水平差分（predictor=2）の復元
        img[i] = row[c0:c0 + WIN]
    n = WIN // BLOCK
    blocks = img[:n * BLOCK, :n * BLOCK].reshape(n, BLOCK, n, BLOCK).transpose(0, 2, 1, 3).reshape(n, n, BLOCK * BLOCK)
    p90 = np.percentile(blocks, 90, axis=2).round().astype(int)
    # 窓の四隅（メルカトル → 経緯度）
    def ll(px, py):
        x = ORIGIN_X + px * RES; y = ORIGIN_Y - py * RES
        return (x / 20037508.342789244 * 180, math.degrees(2 * math.atan(math.exp(y / 20037508.342789244 * math.pi)) - math.pi / 2))
    nw, se = ll(c0, r0), ll(c0 + n * BLOCK, r0 + n * BLOCK)
    data = {
        "source": "Meta・WRI High Resolution Canopy Height Maps（AWS Open Data、CC BY 4.0）。タイル " + TILE,
        "cellPx": BLOCK, "cellNote": "12画素（Webメルカトルで約14m、地上で約12m）ごとの90パーセンタイル樹高（m）",
        "acq": acq, "fetched": "2026-11-13", "n": n, "nw": nw, "se": se, "valid": int((img > 0).sum()), "total": int(img.size),
        "h": p90.tolist(),
    }
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.CHM=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("出力", out, f"{n}x{n}セル 北西{nw} 南東{se} 樹高>0の画素 {data['valid'] / data['total']:.1%} 最大 {int(img.max())} m")
    if png:
        from PIL import Image
        v = np.clip(p90 * 255 // 35, 0, 255).astype(np.uint8)
        Image.fromarray(v).resize((n * 3, n * 3), Image.NEAREST).save(png)


if __name__ == "__main__":
    main()
