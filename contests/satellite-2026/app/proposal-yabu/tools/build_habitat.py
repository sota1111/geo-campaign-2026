#!/usr/bin/env python3
"""藪払い優先地図：クマが出やすい範囲（論文ベース）の判定と、京都府の目撃データでの検証。
すべて GET のみ（POST・認証なし）。

判定（式は README と lib.js の HAB に同じ）
  R   = 林縁・河川の選択度（Takahata ほか 2014 の選択オッズ。雌の値）
        林縁から d m の画素の R = exp(b * exp(-0.01 d))、b = ln(3.74)/exp(-0.2)
        （20m で 3.74、100m で 1.81 になり、論文の表の値と一致する。一致は本スクリプトが確認する）
        河川に接する林縁（林縁20m以内かつ河川20m以内）は 21.45（論文の値）
  S   = R(区画内の最大) x 集落係数（建物から500m以内=1、外=0.5 仮） x 市街地係数（建物用地が区画の半分以上=0.5 仮）
  等級 = 高: S >= 3.74（林縁20mの選択度）／中: S >= 1.81（林縁100mの選択度）／低: それ未満

入力（cache に保存。再実行時は cache を使う）
  1. 京都府「クマ目撃情報」CSV（BODIK、CC BY 4.0）
  2. OpenStreetMap の建物・河川（Overpass API の GET。ODbL）
  3. 国土数値情報 土地利用細分メッシュ L03-b（令和3年）5335（GET。国土数値情報の利用約款）
  4. Sentinel-2 L2A 2026-05-17 の B04・B08・SCL（既存の tools/cog_window.py）

使い方:  python3 tools/build_habitat.py --cache /path/to/cache
要 numpy・scipy・pyproj・fiona
"""
import argparse
import csv
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile

import numpy as np
import pyproj
from scipy import ndimage
from scipy.spatial import cKDTree
from scipy.stats import rankdata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cog_window import Cog, UA  # noqa: E402

EPSG_UTM = 32653
CELL = 100
PIX = 10
# 検証範囲（国土数値情報 5335 メッシュと Sentinel-2 タイル 53SNV の両方に収まる範囲。丹後〜福知山の一部）
VAL_BBOX = (135.00, 35.34, 135.40, 35.70)   # 西, 南, 東, 北
# 表示範囲（地図の移動範囲）。与謝野町周辺 ±0.05 度
SHOW_BBOX = (135.01, 35.40, 135.22, 35.60)

KUMA_CSV = "https://data.bodik.jp/dataset/e40b887d-0212-4ad5-8cf8-4ae3a2b5f4dd/resource/5eb145e6-5b3f-489d-a991-3d2da42c109b/download/260002bearfy.csv"
L03_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/L03-b/L03-b-21/L03-b-21_5335-jgd2011_GML.zip"
S2_BASE = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/53/S/NV/2026/5/S2C_53SNV_20260517_0_L2A/"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

# ---- 論文の値（Takahata ほか 2014 PLoS ONE 9(1): e86181。雌の値。原文のまま） ----
ODDS_EDGE_20 = 3.74      # 林縁 20 m の選択オッズ（雌）
ODDS_EDGE_100 = 1.81     # 林縁 100 m（雌）
ODDS_RIVEREDGE_20 = 21.45  # 河川に接する林縁 20 m（雌）
BETA = math.log(ODDS_EDGE_20) / math.exp(-0.01 * 20)   # 林縁の距離変換 exp(-0.01 d) に対する係数
# ---- 仮の係数（論文に数値がない。向きだけの根拠。検証結果で調整していない） ----
G_FAR_FROM_HOUSE = 0.5   # 建物から 500m より遠い（仮）
G_URBAN = 0.5            # 市街地（建物用地が区画の半分以上）（仮）
SETTLE_M = 500
TIER_HIGH, TIER_MID = ODDS_EDGE_20, ODDS_EDGE_100

# 国土数値情報 L03-b の土地利用種別
LU_NOT_FOREST = {"0100", "0200", "0700", "0901", "0902", "1000", "1600"}   # 田・その他農用地・建物用地・道路・鉄道・その他用地・ゴルフ場
LU_WATER = {"1100", "1400", "1500"}   # 河川地及び湖沼・海浜・海水域


def http_get(urls, dest, params=None, retries=3):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    last = None
    for base in urls:
        for t in range(retries):
            try:
                url = base + ("?" + urllib.parse.urlencode(params) if params else "")
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=600) as r:
                    data = r.read()
                if params and not data.lstrip().startswith(b"{"):
                    raise ValueError("Overpass が JSON を返さない: " + data[:120].decode("utf-8", "replace"))
                open(dest, "wb").write(data)
                return
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(10 * (t + 1))
    raise RuntimeError("取得失敗 %s: %s" % (dest, last))


def fetch_all(cache):
    os.makedirs(cache, exist_ok=True)
    http_get([KUMA_CSV], os.path.join(cache, "kyoto_bear.csv"))
    http_get([L03_URL], os.path.join(cache, "L03-b-21_5335.zip"))
    w, s, e, n = VAL_BBOX
    mlo, mla = (w + e) / 2, (s + n) / 2
    boxes = [(s, w, mla, mlo), (s, mlo, mla, e), (mla, w, n, mlo), (mla, mlo, n, e)]
    for i, b in enumerate(boxes, 1):
        q = '[out:json][timeout:300];way["building"](%s,%s,%s,%s);out center;' % b
        http_get(OVERPASS, os.path.join(cache, "osm_b%d.json" % i), {"data": q})
    q = '[out:json][timeout:300];way["waterway"~"^(river|stream)$"](%s,%s,%s,%s);out geom;' % (s, w, n, e)
    http_get(OVERPASS, os.path.join(cache, "osm_w.json"), {"data": q})


def load_l03(cache):
    """100m 土地利用メッシュを (緯度idx, 経度idx) の配列にする。"""
    import fiona
    npy = os.path.join(cache, "l03_grid.npy")
    if os.path.exists(npy):
        return np.load(npy)
    d = os.path.join(cache, "l03")
    os.makedirs(d, exist_ok=True)
    zipfile.ZipFile(os.path.join(cache, "L03-b-21_5335.zip")).extractall(d)
    grid = np.zeros((1000, 1000), dtype="<U4")   # 余裕を持たせた配列
    with fiona.open(os.path.join(d, "L03-b-21_5335.shp"), encoding="cp932") as f:
        for r in f:
            p = list(r["properties"].values())
            ring = r["geometry"]["coordinates"][0]
            lon = (min(c[0] for c in ring) + max(c[0] for c in ring)) / 2
            lat = (min(c[1] for c in ring) + max(c[1] for c in ring)) / 2
            i = int((lat - 35.0 - 1 / 3) / (1 / 1200))   # 4.5秒=1/800度（経度）、3秒=1/1200度（緯度）
            j = int((lon - 135.0) / (1 / 800))
            grid[i, j] = p[1]
    np.save(npy, grid)
    return grid


def band(cache, name, box):
    key = os.path.join(cache, "val_%s.npy" % name)
    if os.path.exists(key):
        return np.load(key)
    k = Cog(S2_BASE + name + ".tif")
    xw, yn, xe, ys = box
    a, ox, oy = k.window(xw, yn, xe, ys)
    assert abs(ox - xw) < 1e-6 and abs(oy - yn) < 1e-6, (ox, xw, oy, yn)
    np.save(key, a)
    return a


def auc(score, label):
    """順位和による AUC（同点は平均順位）。label は bool。"""
    r = rankdata(score)
    n1 = int(label.sum())
    n0 = len(label) - n1
    if n1 == 0 or n0 == 0:
        return None
    return float((r[label].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    cache = a.cache
    if not a.no_fetch:
        fetch_all(cache)

    # 論文の表の値との一致を確認（原文: 林縁 20m で 3.74、100m で 1.81）
    r100 = math.exp(BETA * math.exp(-1.0))
    assert abs(r100 - ODDS_EDGE_100) < 0.01, r100

    to_utm = pyproj.Transformer.from_crs(4326, EPSG_UTM, always_xy=True)
    to_ll = pyproj.Transformer.from_crs(EPSG_UTM, 4326, always_xy=True)
    xw, ys = to_utm.transform(VAL_BBOX[0], VAL_BBOX[1])
    xe, yn = to_utm.transform(VAL_BBOX[2], VAL_BBOX[3])
    x0 = math.floor(xw / CELL) * CELL
    x1 = math.ceil(xe / CELL) * CELL
    y0 = math.floor(ys / CELL) * CELL
    y1 = math.ceil(yn / CELL) * CELL
    nx, ny = (x1 - x0) // CELL, (y1 - y0) // CELL
    H, W = ny * 10, nx * 10
    box = (x0, y1, x1, y0)
    print("検証範囲 %d x %d 区画（100m）" % (nx, ny), file=sys.stderr)

    # ---- 衛星 NDVI（5月） ----
    red = band(cache, "B04", box).astype(np.float32) / 10000
    nir = band(cache, "B08", box).astype(np.float32) / 10000
    scl = band(cache, "SCL", box)
    scl = np.kron(scl, np.ones((2, 2), dtype=scl.dtype))[:H, :W]
    red, nir = red[:H, :W], nir[:H, :W]
    ndvi = (nir - red) / np.maximum(nir + red, 1e-6)
    valid = np.isin(scl, [4, 5]) & (red > 0)

    # ---- 土地利用（L03-b）を 10m 画素に ----
    grid = load_l03(cache)
    xs = x0 + (np.arange(W) + 0.5) * PIX
    yy = y1 - (np.arange(H) + 0.5) * PIX
    lon_row, _ = to_ll.transform(xs, np.full(W, (y0 + y1) / 2))
    _, lat_col = to_ll.transform(np.full(H, (x0 + x1) / 2), yy)
    jj = np.clip(((lon_row - 135.0) * 800).astype(int), 0, 999)
    ii = np.clip(((lat_col - 35.0 - 1 / 3) * 1200).astype(int), 0, 999)
    lu = grid[ii[:, None], jj[None, :]]          # (H, W) 文字列
    lu_known = lu != ""
    is_nf = np.isin(lu, list(LU_NOT_FOREST))
    is_water = np.isin(lu, list(LU_WATER))
    is_bld = lu == "0700"

    # ---- 森林と開けた所（林縁の元）----
    forest = np.where(valid, (ndvi >= 0.6) & ~is_nf, lu == "0500")
    forest = forest | is_water | ~lu_known              # 水面・範囲外は林縁をつくらない
    # 小さな開けた所（5画素=約500m2 未満）は雑音として森林に戻す
    lab, n = ndimage.label(~forest)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    small = np.isin(lab, np.where(sizes < 5)[0] + 1)
    forest = forest | small
    d_in = ndimage.distance_transform_edt(forest, sampling=PIX)       # 森林側: 開けた所までの距離
    d_out = ndimage.distance_transform_edt(~forest, sampling=PIX)     # 開けた側: 森林までの距離
    d_edge = np.where(forest, d_in - PIX / 2, d_out - PIX / 2)
    d_edge = np.maximum(d_edge, 0)
    del d_in, d_out, lab

    # ---- 河川（OSM）----
    wj = json.load(open(os.path.join(cache, "osm_w.json"), encoding="utf-8"))
    rmask = np.zeros((H, W), bool)
    nway = 0
    for e in wj["elements"]:
        g = e.get("geometry")
        if not g or len(g) < 2:
            continue
        nway += 1
        px, py = to_utm.transform([p["lon"] for p in g], [p["lat"] for p in g])
        for k in range(len(px) - 1):
            L = math.hypot(px[k + 1] - px[k], py[k + 1] - py[k])
            m = max(2, int(L / 5) + 1)
            tx = np.linspace(px[k], px[k + 1], m)
            ty = np.linspace(py[k], py[k + 1], m)
            ci = ((y1 - ty) // PIX).astype(int)
            cj = ((tx - x0) // PIX).astype(int)
            ok = (ci >= 0) & (ci < H) & (cj >= 0) & (cj < W)
            rmask[ci[ok], cj[ok]] = True
    d_river = ndimage.distance_transform_edt(~rmask, sampling=PIX) if rmask.any() else np.full((H, W), 1e6)

    # ---- 画素ごとの選択度 R ----
    R = np.exp(BETA * np.exp(-0.01 * d_edge)).astype(np.float32)
    riv_edge = (d_edge <= 20) & (d_river <= 20)
    R = np.where(riv_edge, np.float32(ODDS_RIVEREDGE_20), R)
    R = np.where(is_water, 0, R)                       # 水面は評価しない
    f = CELL // PIX
    Rc = R.reshape(ny, f, nx, f).max(axis=(1, 3))
    rivc = riv_edge.reshape(ny, f, nx, f).any(axis=(1, 3))
    bld_share = is_bld.reshape(ny, f, nx, f).mean(axis=(1, 3))
    water_share = is_water.reshape(ny, f, nx, f).mean(axis=(1, 3))
    known_share = lu_known.reshape(ny, f, nx, f).mean(axis=(1, 3))
    edge_min = d_edge.reshape(ny, f, nx, f).min(axis=(1, 3))

    # ---- 建物（OSM）----
    bx = []
    ts = ""
    for i in range(1, 5):
        d = json.load(open(os.path.join(cache, "osm_b%d.json" % i), encoding="utf-8"))
        ts = max(ts, d.get("osm3s", {}).get("timestamp_osm_base", ""))
        for e in d["elements"]:
            c = e.get("center")
            if c:
                bx.append((c["lon"], c["lat"]))
    bx = np.array(sorted(set(bx)))
    bxy = np.array(to_utm.transform(bx[:, 0], bx[:, 1])).T
    tb = cKDTree(bxy)
    cxs = x0 + (np.arange(nx) + 0.5) * CELL
    cys = y1 - (np.arange(ny) + 0.5) * CELL
    CX, CY = np.meshgrid(cxs, cys)
    d_house = tb.query(np.stack([CX.ravel(), CY.ravel()], 1))[0].reshape(ny, nx)

    near = d_house <= SETTLE_M
    urban = bld_share >= 0.5
    S = Rc * np.where(near, 1.0, G_FAR_FROM_HOUSE) * np.where(urban, G_URBAN, 1.0)
    tier = np.where(S >= TIER_HIGH, 2, np.where(S >= TIER_MID, 1, 0)).astype(np.int8)   # 2高 1中 0低

    # ---- 目撃 ----
    txt = open(os.path.join(cache, "kyoto_bear.csv"), encoding="utf-8-sig").read()
    sg = []
    for r in csv.DictReader(io.StringIO(txt)):
        try:
            lo, la = float(r["経度"]), float(r["緯度"])
        except ValueError:
            continue
        if VAL_BBOX[0] <= lo < VAL_BBOX[2] and VAL_BBOX[1] <= la < VAL_BBOX[3]:
            sg.append((lo, la, int(r["年度"])))
    sg = np.array(sg)
    sx, sy = to_utm.transform(sg[:, 0], sg[:, 1])
    si = ((y1 - np.array(sy)) // CELL).astype(int)
    sj = ((np.array(sx) - x0) // CELL).astype(int)
    sy_year = sg[:, 2].astype(int)
    okp = (si >= 0) & (si < ny) & (sj >= 0) & (sj < nx)
    si, sj, sy_year = si[okp], sj[okp], sy_year[okp]

    def count(mask):
        c = np.zeros((ny, nx), int)
        np.add.at(c, (si[mask], sj[mask]), 1)
        return c

    # 評価対象: 水面・範囲外が半分以上の区画を除く
    universe = (water_share < 0.5) & (known_share > 0.5)
    base = -d_house                                   # 比較の基準: 建物から近いほど高い
    scores = {
        "S": S,                                       # 論文ベースの判定（全部）
        "R": Rc,                                      # 林縁・河川だけ（集落係数なし）
        "base": base,                                 # 人家からの距離だけ
    }
    periods = {
        "all": ("2009〜2018年度", (sy_year >= 2009)),
        "all_no2010": ("2010年度を除く", (sy_year != 2010)),
        "first": ("2009〜2013年度", (sy_year <= 2013)),
        "first_no2010": ("2009〜2013年度（2010年度を除く）", (sy_year <= 2013) & (sy_year != 2010)),
        "second": ("2014〜2018年度", (sy_year >= 2014)),
    }
    zones = {"land": ("検証範囲の全区画", universe), "near500": ("建物から500m以内の区画", universe & near)}
    area_km2 = CELL * CELL / 1e6
    val = {}
    for pk, (plabel, pm) in periods.items():
        cnt = count(pm)
        for zk, (zlabel, zm) in zones.items():
            lab = (cnt > 0)[zm]
            ent = {"period": plabel, "zone": zlabel, "n_cells": int(zm.sum()), "n_pos": int(lab.sum()), "n_sights": int(cnt[zm].sum()), "auc": {}, "tiers": {}}
            for sk, sv in scores.items():
                ent["auc"][sk] = auc(sv[zm], lab)
            for tk, tname in ((2, "高"), (1, "中"), (0, "低")):
                m = zm & (tier == tk)
                nc = int(m.sum())
                ent["tiers"][tname] = {"n_cells": nc, "n_sights": int(cnt[m].sum()), "dens": round(float(cnt[m].sum()) / (nc * area_km2), 2) if nc else None,
                                       "p_cell": round(float((cnt[m] > 0).mean()), 3) if nc else None}
            val["%s|%s" % (pk, zk)] = ent
    # 感度: 集落係数・市街地係数なしで林縁・河川だけ、と建物距離で分けた層ごとの目撃（通報の偏りの目安）
    bands = [(0, 100), (100, 250), (250, 500), (500, 1000), (1000, 1e9)]
    cnt_all = count(periods["all"][1])
    dband = []
    for lo, hi in bands:
        m = universe & (d_house >= lo) & (d_house < hi)
        nc = int(m.sum())
        dband.append({"from": lo, "to": None if hi > 1e8 else hi, "n_cells": nc, "n_sights": int(cnt_all[m].sum()), "dens": round(float(cnt_all[m].sum()) / (nc * area_km2), 2) if nc else None})
    # 建物から500m以内の区画だけで、人家からの距離帯ごとに等級別の密度（距離で揃えても差が出るか）
    strat = []
    for lo, hi in ((0, 100), (100, 250), (250, 500)):
        row = {"from": lo, "to": hi, "tiers": {}}
        for tk, tname in ((2, "高"), (1, "中"), (0, "低")):
            m = universe & (d_house >= lo) & (d_house < hi) & (tier == tk)
            nc = int(m.sum())
            row["tiers"][tname] = {"n_cells": nc, "n_sights": int(cnt_all[m].sum()), "dens": round(float(cnt_all[m].sum()) / (nc * area_km2), 2) if nc else None}
        strat.append(row)
    # 内訳の寄与: 区画の最大選択度が林縁20m以内（>=3.74）かどうかだけで見た場合
    out_meta = {
        "val_bbox": list(VAL_BBOX), "show_bbox": list(SHOW_BBOX), "cell_m": CELL,
        "n_cells_val": int(universe.sum()), "n_sights_val": int(len(si)), "n_sights_in_bbox_total": int(len(sg)),
        "n_buildings": int(len(bx)), "n_waterways": nway, "osm_timestamp": ts,
        "scene": "S2C_53SNV_20260517_0_L2A", "l03": "国土数値情報 土地利用細分メッシュ L03-b（令和3年）5335",
        "beta": round(BETA, 4), "r100": round(r100, 3),
        "g_far": G_FAR_FROM_HOUSE, "g_urban": G_URBAN, "settle_m": SETTLE_M,
        "tier_share_val": {n: round(float((tier[universe] == k).mean()), 3) for k, n in ((2, "高"), (1, "中"), (0, "低"))},
    }

    # ---- 画面用: 表示範囲の高・中の区画、候補区画への付与 ----
    sw, ss = to_utm.transform(SHOW_BBOX[0], SHOW_BBOX[1])
    se, sn = to_utm.transform(SHOW_BBOX[2], SHOW_BBOX[3])
    i0, i1 = max(0, int((y1 - sn) // CELL)), min(ny, int((y1 - ss) // CELL) + 1)
    j0, j1 = max(0, int((sw - x0) // CELL)), min(nx, int((se - x0) // CELL) + 1)
    show = []
    for i in range(i0, i1):
        for j in range(j0, j1):
            if universe[i, j] and tier[i, j] >= 1:
                lo, la = to_ll.transform(cxs[j], cys[i])
                show.append([round(lo, 5), round(la, 5), int(tier[i, j]), round(float(S[i, j]), 1), int(rivc[i, j])])
    cells = json.load(open(os.path.join(HERE, "..", "data", "yabu.json"), encoding="utf-8"))["cells"]
    cand = {}
    for c in cells:
        cx, cy = to_utm.transform(c["lon"], c["lat"])
        i, j = int((y1 - cy) // CELL), int((cx - x0) // CELL)
        cand[c["id"]] = [int(tier[i, j]), round(float(S[i, j]), 2), int(round(float(edge_min[i, j]))), int(rivc[i, j]), int(round(float(d_house[i, j])))]
    shown_n = {n: int(sum(1 for s_ in show if s_[2] == k)) for k, n in ((2, "高"), (1, "中"))}
    cand_n = {n: sum(1 for v in cand.values() if v[0] == k) for k, n in ((2, "高"), (1, "中"), (0, "低"))}
    out = {"meta": out_meta, "val": val, "dband": dband, "strat": strat, "show": show, "cand": cand, "show_n": shown_n, "cand_n": cand_n}
    txt = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    d = os.path.join(HERE, "..", "data")
    open(os.path.join(d, "habitat.json"), "w", encoding="utf-8").write(txt)
    open(os.path.join(d, "habitat.js"), "w", encoding="utf-8").write("window.HABITAT=" + txt + ";")
    print("出力 %d bytes／表示 高%d 中%d／候補 %s" % (len(txt), shown_n["高"], shown_n["中"], cand_n), file=sys.stderr)
    for k in ("all|land", "all|near500", "first|near500", "second|near500", "all_no2010|near500"):
        e = val[k]
        print(k, e["n_cells"], e["n_pos"], e["auc"], {t: (v["dens"], v["n_cells"]) for t, v in e["tiers"].items()}, file=sys.stderr)


if __name__ == "__main__":
    main()
