#!/usr/bin/env python3
"""提案 藪払い優先地図：デモ用データ作成（すべて GET のみ。POST・認証なし）。

入力（取得して cache に保存。再実行時は cache を使う）
  1. 京都府「クマ目撃情報」CSV（BODIK、CC BY 4.0）  … 目撃位置・年月日・環境区分
  2. OpenStreetMap の建物・学校・幼稚園（Overpass API の GET。ODbL）
  3. Sentinel-2 L2A（AWS Open Data / Earth Search。新緑期(5月)と落葉期(2月)の2時期）の B04(赤)・B08(近赤外)・SCL

処理: 100 m 格子（約1ha）ごとに、植生指数（NDVI）・夏冬差・林縁度（開けた所・建物に接する植生の割合）
を求め、目撃履歴と建物・学校との距離を重ねて点数化 → data/yabu.js（ブラウザ用）と data/yabu.json を出力。

使い方:  python3 tools/build_data.py --cache /path/to/cache
"""
import argparse
import csv
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import pyproj
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cog_window import Cog, UA  # noqa: E402

# ---- 対象地域: 京都府与謝野町（旧 加悦町・野田川町）周辺 ----
BBOX = (135.06, 35.45, 135.17, 35.55)      # 西, 南, 東, 北（WGS84）
EPSG_UTM = 32653                           # UTM 53N（Sentinel-2 タイル 53SNV）
CELL = 100                                 # 格子 100 m
PIX = 10                                   # Sentinel-2 の画素 10 m
YEAR_FROM, YEAR_TO = 2009, 2018            # CSV に含まれる年度

KUMA_CSV = "https://data.bodik.jp/dataset/e40b887d-0212-4ad5-8cf8-4ae3a2b5f4dd/resource/5eb145e6-5b3f-489d-a991-3d2da42c109b/download/260002bearfy.csv"
S2_BASE = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/53/S/NV/"
SCENES = {
    "green": {"id": "S2C_53SNV_20260517_0_L2A", "date": "2026-05-17", "path": "2026/5/"},
    "winter": {"id": "S2B_53SNV_20260221_0_L2A", "date": "2026-02-21", "path": "2026/2/"},
}
VILLAGE_ENV = {"集落内", "路上", "畑", "果樹園", "水田", "市街地"}   # 人里の中で目撃された区分

# 点数の配点（説明用の仮置き。根拠のある値ではない）
W = {"veg": 10, "edge": 10, "drop": 10, "sight": 30, "house": 20, "houses_n": 10, "school": 10}


def get(url, dest, binary=True):
    if os.path.exists(dest):
        return
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    with open(dest, "wb") as f:
        f.write(data)


def fetch_all(cache):
    os.makedirs(cache, exist_ok=True)
    get(KUMA_CSV, os.path.join(cache, "kyoto_bear.csv"))
    w, s, e, n = BBOX[0], BBOX[1], BBOX[2], BBOX[3]
    bb = "(%s,%s,%s,%s)" % (s, w, n, e)
    q = ('[out:json][timeout:120];(way["building"]%s;way["amenity"="school"]%s;node["amenity"="school"]%s;'
         'way["amenity"="kindergarten"]%s;node["amenity"="kindergarten"]%s;);out center tags;') % ((bb,) * 5)
    get("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q), os.path.join(cache, "osm.json"))


def load_sightings(cache):
    txt = open(os.path.join(cache, "kyoto_bear.csv"), encoding="utf-8-sig").read()
    out = []
    for r in csv.DictReader(io.StringIO(txt)):
        try:
            lat, lon = float(r["緯度"]), float(r["経度"])
        except ValueError:
            continue
        if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
            continue
        out.append({"lat": lat, "lon": lon, "date": r["目撃年月日"], "year": int(r["年度"]), "env": r["環境区分"], "town": r["市町村名"]})
    return out


def load_osm(cache):
    d = json.load(open(os.path.join(cache, "osm.json"), encoding="utf-8"))
    bld, sch = [], []
    for e in d["elements"]:
        t = e.get("tags", {})
        c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
        if c.get("lat") is None:
            continue
        if "building" in t:
            bld.append((c["lon"], c["lat"]))
        elif t.get("amenity") in ("school", "kindergarten"):
            sch.append({"lon": c["lon"], "lat": c["lat"], "name": t.get("name", "（名称なし）"), "kind": t["amenity"]})
    return bld, sch, d.get("osm3s", {}).get("timestamp_osm_base", "")


def band_window(cache, scene, band, box):
    key = os.path.join(cache, "%s_%s.npy" % (scene, band))
    if os.path.exists(key):
        return np.load(key)
    url = S2_BASE + SCENES[scene]["path"] + SCENES[scene]["id"] + "/" + band + ".tif"
    k = Cog(url)
    xw, yn, xe, ys = box
    px = 20 if band == "SCL" else 10
    assert abs(k.scale[0] - px) < 1e-6
    a, ox, oy = k.window(xw, yn, xe, ys)
    assert abs(ox - xw) < 1e-6 and abs(oy - yn) < 1e-6, (ox, xw, oy, yn)
    np.save(key, a)
    return a


def ndvi_scene(cache, scene, box):
    red = band_window(cache, scene, "B04", box).astype(np.float32)
    nir = band_window(cache, scene, "B08", box).astype(np.float32)
    scl = band_window(cache, scene, "SCL", box)
    scl = np.kron(scl, np.ones((2, 2), dtype=scl.dtype))[: red.shape[0], : red.shape[1]]
    # Earth Search の COG は BOA オフセット補正済み（stac の boa_offset_applied=True。赤の中央値が約230で、
    # さらに1000を引くと負になることでも確認）。反射率 = DN / 10000
    r = red / 10000
    n = nir / 10000
    nd = (n - r) / np.maximum(n + r, 1e-6)
    # 欠測・雲・雲影・雪・水面は除外（4=植生 5=裸地 7=分類不能 のみ使う）
    valid = np.isin(scl, [4, 5]) & (red > 0)
    return np.where(valid, nd, np.nan).astype(np.float32), valid


def block_mean(a, f):
    h, w = a.shape[0] // f * f, a.shape[1] // f * f
    b = a[:h, :w].reshape(h // f, f, w // f, f)
    with np.errstate(all="ignore"):
        return np.nanmean(b, axis=(1, 3)), np.isfinite(b).mean(axis=(1, 3))


def build(cache, out_dir, debug_png=None):
    to_utm = pyproj.Transformer.from_crs(4326, EPSG_UTM, always_xy=True)
    to_ll = pyproj.Transformer.from_crs(EPSG_UTM, 4326, always_xy=True)
    xw, ys = to_utm.transform(BBOX[0], BBOX[1])
    xe, yn = to_utm.transform(BBOX[2], BBOX[3])
    x0 = math.floor(xw / CELL) * CELL
    x1 = math.ceil(xe / CELL) * CELL
    y0 = math.floor(ys / CELL) * CELL
    y1 = math.ceil(yn / CELL) * CELL
    box = (x0, y1, x1, y0)   # 西・北・東・南
    nx, ny = (x1 - x0) // CELL, (y1 - y0) // CELL

    nd_s, ok_s = ndvi_scene(cache, "green", box)
    nd_w, ok_w = ndvi_scene(cache, "winter", box)
    f = CELL // PIX

    # 建物（OSM）
    bld, sch, osm_ts = load_osm(cache)
    bxy = np.array([to_utm.transform(lo, la) for lo, la in bld])
    sxy = np.array([to_utm.transform(s["lon"], s["lat"]) for s in sch]) if sch else np.zeros((0, 2))
    # 建物画素（中心点のある 10 m 画素を建物とみなす。小さな近似）
    bpix = np.zeros(nd_s.shape, bool)
    bi = ((y1 - bxy[:, 1]) // PIX).astype(int)
    bj = ((bxy[:, 0] - x0) // PIX).astype(int)
    m = (bi >= 0) & (bi < bpix.shape[0]) & (bj >= 0) & (bj < bpix.shape[1])
    bpix[bi[m], bj[m]] = True
    bpix = ndimage.binary_dilation(bpix, iterations=1)

    veg = np.nan_to_num(nd_s, nan=0) >= 0.6              # 夏に茂っている画素
    openpix = ((np.nan_to_num(nd_s, nan=1) < 0.45) & ok_s) | bpix   # 開けた所（裸地・水田の落水・建物等）
    near_open = ndimage.binary_dilation(openpix, structure=np.ones((3, 3), bool), iterations=3)   # 約30 m 以内
    edge = veg & near_open

    mean_s, cov_s = block_mean(nd_s, f)
    mean_w, cov_w = block_mean(nd_w, f)
    veg_share = veg[: ny * f, : nx * f].reshape(ny, f, nx, f).mean(axis=(1, 3))
    edge_share = edge[: ny * f, : nx * f].reshape(ny, f, nx, f).mean(axis=(1, 3))
    with np.errstate(all="ignore"):
        std_s = np.sqrt(np.nanmean((nd_s[: ny * f, : nx * f].reshape(ny, f, nx, f) - mean_s[:, None, :, None]) ** 2, axis=(1, 3)))
    bld_share = bpix[: ny * f, : nx * f].reshape(ny, f, nx, f).mean(axis=(1, 3))

    # 目撃（UTM）
    sg = load_sightings(cache)
    sxyk = np.array([to_utm.transform(s["lon"], s["lat"]) for s in sg])
    vil = np.array([s["env"] in VILLAGE_ENV for s in sg])

    from scipy.spatial import cKDTree
    tb, tk = cKDTree(bxy), cKDTree(sxyk)
    ts = cKDTree(sxy) if len(sxy) else None
    cxs = x0 + (np.arange(nx) + 0.5) * CELL
    cys = y1 - (np.arange(ny) + 0.5) * CELL
    years = np.array([s["year"] for s in sg])
    cells = []
    for j in range(ny):
        for i in range(nx):
            # 雲・雪で欠測の多い格子、建物が多い格子（=集落そのもの）、植生が薄い格子は候補にしない
            if not (cov_s[j, i] >= 0.7 and cov_w[j, i] >= 0.5):
                continue
            c = (cxs[i], cys[j])
            d_b = float(tb.query(c)[0])
            if d_b > 400 or bld_share[j, i] > 0.15 or mean_s[j, i] < 0.5 or edge_share[j, i] < 0.10:
                continue
            near_k = tk.query_ball_point(c, 500)
            d_s, k_s = (float(ts.query(c)[0]), int(ts.query(c)[1])) if ts else (None, None)
            ring = [to_ll.transform(x0 + (i + a) * CELL, y1 - (j + b) * CELL) for a, b in ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0))]
            clon, clat = to_ll.transform(*c)
            cells.append({
                "lat": round(clat, 6), "lon": round(clon, 6),
                "ring": [[round(p[0], 6), round(p[1], 6)] for p in ring],
                "ndvi_g": round(float(mean_s[j, i]), 3), "ndvi_w": round(float(mean_w[j, i]), 3),
                "veg": round(float(veg_share[j, i]), 3), "edge": round(float(edge_share[j, i]), 3),
                "d_house": round(d_b),
                "n_house300": len(tb.query_ball_point(c, 300)),
                "d_school": None if d_s is None else round(d_s),
                "school": None if k_s is None else sch[k_s]["name"],
                "n_sight500": len(near_k),
                "n_sight500_recent": int(sum(1 for k in near_k if years[k] >= 2014)),
                "n_sight500_village": int(sum(1 for k in near_k if vil[k])),
                "last_year": int(max((years[k] for k in near_k), default=0)) or None,
            })
    # 並びを安定させ（北→南、西→東）、番号を振る
    cells.sort(key=lambda c: (-c["lat"], c["lon"]))
    for n, c in enumerate(cells, 1):
        c["id"] = "Y%03d" % n
    print("格子", nx, "x", ny, "候補", len(cells), file=sys.stderr)

    if debug_png:
        from PIL import Image
        def img(a, lo, hi):
            v = np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo), 0, 1)
            return Image.fromarray((v * 255).astype(np.uint8))
        img(nd_s, -0.1, 0.9).save(os.path.join(debug_png, "ndvi_green.png"))
        img(nd_w, -0.1, 0.9).save(os.path.join(debug_png, "ndvi_winter.png"))
        im = np.zeros(nd_s.shape + (3,), np.uint8)
        im[veg] = (80, 140, 80)
        im[edge] = (230, 140, 20)
        im[bpix] = (30, 30, 200)
        for c in cells:
            xx, yy = to_utm.transform(c["lon"], c["lat"])
            jj, ii = int((y1 - yy) // PIX), int((xx - x0) // PIX)
            im[max(jj - 5, 0):jj + 5, max(ii - 5, 0):ii + 5] = (255, 255, 255)
        Image.fromarray(im).save(os.path.join(debug_png, "classes.png"))

    sights = [{"lat": round(s["lat"], 5), "lon": round(s["lon"], 5), "year": s["year"], "env": s["env"]} for s in sg]
    houses = [[round(la, 5), round(lo, 5)] for lo, la in bld]
    schools = [{"lat": round(s["lat"], 5), "lon": round(s["lon"], 5), "name": s["name"], "kind": "幼稚園・保育所" if s["kind"] == "kindergarten" else "学校"} for s in sch]
    meta = {
        "area": "京都府与謝野町（旧 加悦町・野田川町）周辺", "bbox": list(BBOX), "cell_m": CELL,
        "scenes": {k: {"id": v["id"], "date": v["date"]} for k, v in SCENES.items()},
        "osm_timestamp": osm_ts, "sight_years": [min(years.tolist()), max(years.tolist())], "n_sights": len(sg),
        "n_houses": len(bld), "n_cells_all": int(nx * ny),
        "rule": "候補 = 建物から400m以内・新緑期NDVI平均0.5以上・林縁度0.10以上・建物画素15%以下・欠測少",
    }
    return {"meta": meta, "cells": cells, "sights": sights, "houses": houses, "schools": schools}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--debug-png")
    ap.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    if not a.no_fetch:
        fetch_all(a.cache)
    d = build(a.cache, None, a.debug_png)
    out = os.path.join(HERE, "..", "data")
    os.makedirs(out, exist_ok=True)
    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(out, "yabu.json"), "w", encoding="utf-8").write(txt)
    open(os.path.join(out, "yabu.js"), "w", encoding="utf-8").write("window.YABU=" + txt + ";")
    print("出力", len(txt), "bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
