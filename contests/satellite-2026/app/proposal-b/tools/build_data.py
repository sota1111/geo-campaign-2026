"""A54（大規模盛土造成地）と A56（規制区域）と地理院DEMから、横須賀市の台帳データ data/real.js を作る。
使い方: python3 -I tools/build_data.py <fetch_raw.py の出力ディレクトリ> <出力 data/real.js>
  DEMタイルは <出力ディレクトリ>/dem/ にキャッシュする（GET のみ）。
実指標だけを出す。算出できないもの（衛星由来の変化量など）は出さない。
 - 面積: 造成地ポリゴンの面積（局所の正距円筒近似、m²）
 - 比高・平均傾斜: 地理院 標高タイル（DEM5A を優先、無ければ DEM10B）の、ポリゴン内の画素から算出。
   画素数が4未満の小規模な造成地は null（算出不可）。
 - 区域: ポリゴンの代表点が A56 の規制区域に入るか。
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from io import BytesIO

import numpy as np
from PIL import Image
from shapely.geometry import Point, Polygon, shape, mapping
from shapely import contains_xy

CITY = "横須賀市"
NS = {"ksj": "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app", "gml": "http://schemas.opengis.net/gml/3.2.1"}
XLINK = "{http://www.w3.org/1999/xlink}href"
GMLID = "{http://schemas.opengis.net/gml/3.2.1}id"
KIND = {"1": "谷埋め型", "2": "腹付け型", "9": "区分なし"}
ZONE = {"1": "宅地造成等工事規制区域", "2": "特定盛土等規制区域", "9": "区分記載なし"}
TILE = "https://cyberjapandata.gsi.go.jp/xyz/"

raw, outp = sys.argv[1], sys.argv[2]
demdir = os.path.join(raw, "dem")
os.makedirs(demdir, exist_ok=True)


def load_a54():
    root = ET.parse(os.path.join(raw, "A54-23_14_GML", "A54-23_14.xml")).getroot()
    curves = {}
    for c in root.findall("gml:Curve", NS):
        v = [float(t) for t in c.find(".//gml:posList", NS).text.split()]
        curves[c.get(GMLID)] = [(v[i + 1], v[i]) for i in range(0, len(v), 2)]  # 元データは 緯度 経度
    surf = {}
    for s in root.findall("gml:Surface", NS):
        surf[s.get(GMLID)] = curves[s.find(".//gml:exterior//gml:curveMember", NS).get(XLINK)[1:]]
    out = []
    for f in root.findall("ksj:LargeScaleFillSlope", NS):
        if f.find("ksj:localGovernmentName", NS).text != CITY:
            continue
        ring = surf[f.find("ksj:bounds", NS).get(XLINK)[1:]]
        out.append((f.find("ksj:fillSlopeNumber", NS).text, KIND[f.find("ksj:fillSlopeClassification", NS).text], ring))
    return out


def load_a56():
    g = json.load(open(os.path.join(raw, "A56-25_14_GML", "A56-25_14.geojson"), encoding="utf-8"))
    return [(ZONE[f["properties"]["A56_004"]], shape(f["geometry"]), f["properties"]) for f in g["features"] if f["properties"]["A56_003"] == CITY]


def tile_array(kind, z, x, y):
    p = os.path.join(demdir, f"{kind}_{z}_{x}_{y}.png")
    if os.path.exists(p):
        b = open(p, "rb").read()
        if not b:
            return None
    else:
        req = urllib.request.Request(f"{TILE}{kind}/{z}/{x}/{y}.png", headers={"User-Agent": "Mozilla/5.0"})
        try:
            b = urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(p, "wb").close()
                return None
            raise
        open(p, "wb").write(b)
        time.sleep(0.15)
    a = np.asarray(Image.open(BytesIO(b)).convert("RGB")).astype(np.int64)
    v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(v < 2 ** 23, v * 0.01, np.where(v == 2 ** 23, np.nan, (v - 2 ** 24) * 0.01))
    return h


def px(lon, lat, z):
    n = 2 ** z * 256
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def unpx(x, y, z):
    n = 2 ** z * 256
    return x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


def dem_stats(poly):
    minx, miny, maxx, maxy = poly.bounds
    for kind, z in (("dem5a_png", 15), ("dem_png", 14)):
        x0, y1 = px(minx, miny, z)
        x1, y0 = px(maxx, maxy, z)
        x0, y0, x1, y1 = int(x0) - 1, int(y0) - 1, int(x1) + 2, int(y1) + 2
        tx = range(x0 // 256, x1 // 256 + 1)
        ty = range(y0 // 256, y1 // 256 + 1)
        mosaic = np.full(((len(ty)) * 256, (len(tx)) * 256), np.nan)
        ok = True
        for j, yy in enumerate(ty):
            for i, xx in enumerate(tx):
                t = tile_array(kind, z, xx, yy)
                if t is None:
                    ok = False
                    break
                mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = t
            if not ok:
                break
        if not ok:
            continue
        ox, oy = tx[0] * 256, ty[0] * 256
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        lon = np.array([unpx(v + 0.5, 0, z)[0] for v in gx[0]])
        lat = np.array([unpx(0, v + 0.5, z)[1] for v in gy[:, 0]])
        LON, LAT = np.meshgrid(lon, lat)
        mask = contains_xy(poly, LON, LAT)
        sub = mosaic[y0 - oy:y1 + 1 - oy, x0 - ox:x1 + 1 - ox]
        mlat = (miny + maxy) / 2
        step = 40075016.686 * math.cos(math.radians(mlat)) / (2 ** z * 256)
        dzdy, dzdx = np.gradient(sub, step)
        slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
        sel = mask & ~np.isnan(sub) & ~np.isnan(slope)
        if sel.sum() < 4:
            return None
        return {
            "reliefM": round(float(np.nanmax(sub[sel]) - np.nanmin(sub[sel])), 1),
            "slopeDeg": round(float(slope[sel].mean()), 1),
            "elevM": round(float(sub[sel].mean()), 1),
            "demRes": "5m" if kind == "dem5a_png" else "10m",
            "demPx": int(sel.sum()),
        }
    return None


def area_m2(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110574
    pts = [(p[0] * kx, p[1] * ky) for p in ring]
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2


def r5(c):
    return [round(c[0], 5), round(c[1], 5)]


def main():
    zones = load_a56()
    fills = load_a54()
    sites = []
    seen = {}
    for n, (fid, kind, ring) in enumerate(fills):
        poly = Polygon(ring)
        if not poly.is_valid:
            poly = poly.buffer(0)
        rp = poly.representative_point()
        zone = "区域外"
        for zt, zg, _ in zones:
            if zg.contains(rp):
                zone = zt
                break
        d = dem_stats(poly) or {}
        rr = [r5(p) for p in ring]
        dd = [rr[0]]
        for p in rr[1:]:
            if p != dd[-1]:
                dd.append(p)
        if len(dd) > 80:  # 頂点が多い造成地は間引く（約数m以内の形状誤差）
            step = len(dd) // 60 + 1
            dd = dd[::step] + [dd[0]]
        seen[fid] = seen.get(fid, 0) + 1
        if seen[fid] > 1:  # 元データの整理番号が重複する場合は枝番を付ける（A54 側の不備）
            fid = f"{fid}-{seen[fid]}"
        sites.append({"id": fid, "type": kind, "lon": round(rp.x, 5), "lat": round(rp.y, 5), "areaM2": round(area_m2(ring)),
                      "zone": zone, "ring": dd, **d})
        if n % 100 == 0:
            print(n, "/", len(fills), flush=True)
    zs = []
    for zt, zg, pr in zones:
        g = zg.simplify(0.0001)
        geoms = [g] if g.geom_type == "Polygon" else list(g.geoms)
        for gg in geoms:
            zs.append({"type": zt, "ring": [r5(c) for c in gg.exterior.coords], "notice": pr.get("A56_006"), "date": pr.get("A56_007")})
    out = {"city": CITY, "fetched": time.strftime("%Y-%m-%d"), "zones": zs, "sites": sites}
    with open(outp, "w", encoding="utf-8") as f:
        f.write("// 国土数値情報 A54（2023年版）・A56（2025年版）と地理院標高タイルから tools/build_data.py で生成。CC BY 4.0（国土交通省）／地理院タイル（国土地理院）\n")
        f.write("window.REAL = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(len(sites), "sites;", sum(1 for s in sites if "reliefM" in s), "with DEM;", len(zs), "zone polygons")


main()
