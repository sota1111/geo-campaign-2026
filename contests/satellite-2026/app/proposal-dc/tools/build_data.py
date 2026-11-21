#!/usr/bin/env python3
"""処理済みの集計値だけを data/dc.js にまとめる（生のタイル・シェープ・衛星の窓は同梱しない）。
入力はすべて公開データで、取得は GET のみ（fetch_insar.py / fetch_sat.py / fetch_osm.py と、国土数値情報の zip の GET）。
範囲は 経度 130.63〜130.91・緯度 33.69〜33.93（福岡県 直方市・鞍手町・北九州市西部）。0.00025 度（約 23〜28 m）の格子。

usage: python3 -I tools/build_data.py --insar DIR --sat DIR --osm DIR --ksj DIR [--out data/dc.js]
  --ksj : 国土数値情報の zip を展開したディレクトリ（A31b-25_10_5030_SHP, A31b-25_20_5030_SHP, A33-25_40_SHP, A40-16_40_GML, A49-20_40_GML）
要 numpy・scipy・pyproj・fiona・shapely・PIL・opencv(cv2)
"""
import argparse
import glob
import json
import math
import os
import re
import sys

import cv2
import fiona
import numpy as np
import pyproj
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import insar_cells  # noqa: E402

W, S, E, N = 130.63, 33.69, 130.91, 33.93
D = 0.00025
NX, NY = int(round((E - W) / D)), int(round((N - S) / D))
TO_UTM = pyproj.Transformer.from_crs(4326, 32652, always_xy=True)
TO_LL = pyproj.Transformer.from_crs(32652, 4326, always_xy=True)

# 土地の状態（判定の閾値は README と同じ。経験的な仮の値で、較正はしていない）
NDVI_VEG = 0.40          # これ以上は植生
NDVI_BARE = 0.25         # これ未満（植生でも水でも建物でもない）は裸地等
MIN_DEV_HA = 2.0         # 造成の候補（2020 植生 → 2026 裸地等）の最小面積
MIN_IDLE_HA = 4.0        # 遊休地の候補（2020 も 2026 も裸地等）の最小面積
OPEN_PX = 5              # 幅 50 m 未満（道路など）を除く開閉の大きさ（10 m 画素）
MAX_EACH = 25            # 種別ごとの上限（面積の大きい順）
BAD_SCL = (0, 1, 3, 8, 9, 10, 11)  # 欠測・飽和・雲の影・雲・巻雲・雪


# ---------- 共通 ----------
def grid_lonlat():
    lon = W + (np.arange(NX) + 0.5) * D
    lat = N - (np.arange(NY) + 0.5) * D
    return np.meshgrid(lon, lat)


def load_npz(d, name):
    z = np.load(os.path.join(d, name + '.npz'))
    return z['a'], float(z['ox']), float(z['oy']), float(z['px'])


def sample(arr, ox, oy, px, X, Y):
    """UTM の配列から UTM 座標 X,Y の最近傍を取る。範囲外は -1 の位置。"""
    c = np.floor((X - ox) / px).astype(int)
    r = np.floor((oy - Y) / px).astype(int)
    ok = (c >= 0) & (c < arr.shape[1]) & (r >= 0) & (r < arr.shape[0])
    out = np.zeros(X.shape, dtype=arr.dtype)
    out[ok] = arr[r[ok], c[ok]]
    return out, ok


def rle(a):
    """行優先の 1 次元配列を [値, 長さ, ...] に。"""
    a = np.asarray(a, dtype=np.uint8).ravel()
    idx = np.flatnonzero(np.diff(a)) + 1
    starts = np.concatenate(([0], idx))
    ends = np.concatenate((idx, [a.size]))
    out = []
    for s, e in zip(starts, ends):
        out += [int(a[s]), int(e - s)]
    return out


# ---------- 国土数値情報 ----------
def raster_polys(feats, nx=NX, ny=NY):
    """(値, ジオメトリ) の列を、値の小さい順に塗る。穴は無視（内側の高い値が上書きする）。"""
    im = Image.new('L', (nx, ny), 0)
    dr = ImageDraw.Draw(im)
    for val, g in sorted(feats, key=lambda t: t[0]):
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for p in polys:
            ring = [((x - W) / D, (N - y) / D) for x, y in p[0]]
            if len(ring) >= 3:
                dr.polygon(ring, fill=int(val))
    return np.array(im)


def read_feats(path, key):
    out = []
    with fiona.open(path) as f:
        for ft in f.filter(bbox=(W, S, E, N)):
            out.append((ft['properties'][key], ft['geometry']))
    return out


def lower_bound(label):
    m = re.search(r'([\d.]+)m', label)
    return float(m.group(1)) if m else 0.0


def ksj_layers(ksj):
    res = {}
    # A31b 洪水浸水想定区域（想定最大規模）。国管理（_10_）と都道府県管理等（_20_）の大きい方
    fl = np.zeros((NY, NX), np.uint8)
    for sfx in ('10', '20'):
        p = glob.glob(os.path.join(ksj, f'A31b-25_{sfx}_5030_SHP', f'*A31b-20-25_{sfx}_5030.shp'))[0]
        fl = np.maximum(fl, raster_polys(read_feats(p, 'A31b_201')))
    res['flood'] = fl
    # A33 土砂災害警戒区域: 値 = 区域区分(1警戒,2特別警戒) | 現象ビット<<2（1急傾斜,2土石流,4地すべり）
    p = glob.glob(os.path.join(ksj, 'A33-25_40_SHP', 'A33-25_40Polygon.shp'))[0]
    feats = []
    with fiona.open(p) as f:
        for ft in f.filter(bbox=(W, S, E, N)):
            pr = ft['properties']
            feats.append((pr['A33_001'], pr['A33_002'], ft['geometry']))
    zone = np.zeros((NY, NX), np.uint8)
    tmask = np.zeros((NY, NX), np.uint8)
    for t in (1, 2, 3):
        z = raster_polys([(zz, g) for tt, zz, g in feats if tt == t])
        zone = np.maximum(zone, z)
        tmask |= ((z > 0) * (1 << (t - 1))).astype(np.uint8)
    res['slide'] = (zone | (tmask << 2)).astype(np.uint8)
    # A40 津波浸水想定（福岡県 2016 版）と A49 高潮浸水想定（福岡県 2020 版）: 深さの区分（下限の昇順）に 1.. を付ける
    for key, rel, attr in (('tsunami', 'A40-16_40_GML/A40-16_40.shp', 'A40_003'), ('surge', 'A49-20_40_GML/A49-20_40.shp', 'A49_003')):
        feats = read_feats(os.path.join(ksj, rel), attr)
        labels = sorted({v for v, _ in feats}, key=lambda s: (lower_bound(s), s))
        code = {s: i + 1 for i, s in enumerate(labels)}
        res[key] = raster_polys([(code[v], g) for v, g in feats])
        res[key + '_labels'] = labels
    return res


# ---------- 干渉SAR ----------
def insar_layer(insar_dir):
    insar_cells.CACHE = insar_dir
    cls, (tx0, ty0) = insar_cells.load_class_mosaic((W, S, E, N), 'qu')
    X, Y = grid_lonlat()
    n = 2 ** insar_cells.Z
    fx = ((X + 180) / 360 * n - tx0) * 256
    fy = ((1 - np.arcsinh(np.tan(np.radians(Y))) / math.pi) / 2 * n - ty0) * 256
    c, r = np.floor(fx).astype(int), np.floor(fy).astype(int)
    ok = (c >= 0) & (c < cls.shape[1]) & (r >= 0) & (r < cls.shape[0])
    k = np.full(X.shape, -1, np.int16)
    k[ok] = cls[r[ok], c[ok]]
    return (k + 1).astype(np.uint8), cls  # 0 = データなし、1..16 = 階級 0..15


# ---------- Landsat 地表面温度 ----------
def lst_layer(sat):
    st, ox, oy, px = load_npz(sat, 'ls_ST_B10')
    qa, _, _, _ = load_npz(sat, 'ls_QA_PIXEL')
    X, Y = grid_lonlat()
    UX, UY = TO_UTM.transform(X, Y)
    v, ok = sample(st, ox, oy, px, UX, UY)
    q, _ = sample(qa, ox, oy, px, UX, UY)
    c = v.astype(float) * 0.00341802 + 149.0 - 273.15
    bad = (v == 0) | ((q & 0b111110) != 0) | ~ok  # 雲・巻雲・雲の影・（膨張した雲）
    # 熱赤外の元の解像度は 100 m。4×4 格子（約 100 m）の平均にして 0.5 ℃刻みにする（見かけの細かさを出さず、容量も小さくする）
    cm = np.where(bad, np.nan, c)
    blk = cm.reshape(NY // 4, 4, NX // 4, 4)
    with np.errstate(all='ignore'):
        m = np.nanmean(blk, axis=(1, 3))
    m = np.kron(m, np.ones((4, 4)))
    bad = ~np.isfinite(m)
    code = np.clip(np.round((np.nan_to_num(m, nan=10.0) - 10.0) * 2) + 1, 1, 255).astype(np.uint8)  # 1 = 10.0 ℃、0.5 ℃刻み
    code[bad] = 0
    return code, np.where(bad, np.nan, m), bad


# ---------- Sentinel-2 の土地の状態と変化 ----------
def s2_scene(sat, key, bands, offset):
    out = {}
    for b in bands:
        a, ox, oy, px = load_npz(sat, f'{key}_{b}')
        out[b] = (a, ox, oy, px)
    return out


def up(arr_t, ox10, oy10, shape):
    """20 m の配列を 10 m の格子（原点 ox10, oy10）に最近傍で。"""
    a, ox, oy, px = arr_t
    xs = ox10 + (np.arange(shape[1]) + 0.5) * 10.0
    ys = oy10 - (np.arange(shape[0]) + 0.5) * 10.0
    c = np.clip(np.floor((xs - ox) / px).astype(int), 0, a.shape[1] - 1)
    r = np.clip(np.floor((oy - ys) / px).astype(int), 0, a.shape[0] - 1)
    return a[np.ix_(r, c)]


def refl(dn, offset):
    return np.where(dn > 0, dn.astype(np.float32) * 1e-4 + offset, np.nan).astype(np.float32)


def building_mask(osm_dir, shape, ox, oy):
    """OSM の建物を 10 m 画素に塗る（建物が登録されていない所は建物にならない）。"""
    files = sorted(glob.glob(os.path.join(osm_dir, 'bld_*.json')))
    im = Image.new('L', (shape[1], shape[0]), 0)
    dr = ImageDraw.Draw(im)
    n = 0
    for fp in files:
        for el in json.load(open(fp)).get('elements', []):
            g = el.get('geometry')
            if not g or len(g) < 3:
                continue
            xs, ys = TO_UTM.transform([p['lon'] for p in g], [p['lat'] for p in g])
            dr.polygon([((x - ox) / 10.0, (oy - y) / 10.0) for x, y in zip(xs, ys)], fill=1)
            n += 1
    m = np.array(im) > 0
    return ndimage.binary_dilation(m, iterations=1), n, len(files)


def s2_layers(sat, osm_dir):
    now = s2_scene(sat, 's2_now', ['B02', 'B03', 'B04', 'B08', 'B11', 'SCL'], -0.1)
    past = s2_scene(sat, 's2_past', ['B04', 'B08', 'B11', 'SCL'], 0.0)
    _, ox, oy, _ = now['B04']
    shape = now['B04'][0].shape
    red, nir = refl(now['B04'][0], -0.1), refl(now['B08'][0], -0.1)
    grn = refl(now['B03'][0], -0.1)
    swir = refl(up(now['B11'], ox, oy, shape), -0.1)
    scl = up(now['SCL'], ox, oy, shape)
    with np.errstate(invalid='ignore', divide='ignore'):
        ndvi = np.where((nir + red) > 0.02, (nir - red) / (nir + red), np.nan)
        mndwi = (grn - swir) / (grn + swir)
    valid = np.isfinite(ndvi) & ~np.isin(scl, BAD_SCL)
    # 過去の場面（同じ MGRS タイルなので原点は同じはずだが、念のため 10 m 格子に合わせる）
    pr, pnx = refl(up(past['B04'], ox, oy, shape), 0.0), refl(up(past['B08'], ox, oy, shape), 0.0)
    pscl = up(past['SCL'], ox, oy, shape)
    with np.errstate(invalid='ignore', divide='ignore'):
        pndvi = np.where((pnx + pr) > 0.02, (pnx - pr) / (pnx + pr), np.nan)
    pvalid = np.isfinite(pndvi) & ~np.isin(pscl, BAD_SCL)
    # 水: SCL が水、または MNDWI が高い、または近赤外・短波長赤外ともに暗い（水面・影。裸地は両方とも明るい）
    water = (scl == 6) | ((mndwi > 0.2) & (ndvi < 0.2)) | ((nir < 0.08) & (swir < 0.06))
    bld, nb, nf = building_mask(osm_dir, shape, ox, oy) if osm_dir else (np.zeros(shape, bool), 0, 0)
    veg = valid & ~water & (ndvi >= NDVI_VEG)
    built = valid & ~water & bld & ~veg
    bare = valid & ~water & ~veg & ~bld & (ndvi < NDVI_BARE)
    # 0 = 雲・欠測、1 植生、2 裸地等、3 建物（OSM）、4 水、5 その他（NDVI 0.25〜0.40 で建物でない。草地・まばらな植生）
    land = np.zeros(shape, np.uint8)
    land[valid] = 5
    land[veg] = 1
    land[bare] = 2
    land[built] = 3
    land[valid & water] = 4
    # 25 m 格子に落とす前に、周囲 3×3 画素（30 m）で最頻の区分にする（1 画素単位のばらつきを減らす）
    sm = np.stack([ndimage.uniform_filter((land == k).astype(np.float32), size=3) for k in range(1, 6)])
    land2 = (sm.argmax(0) + 1).astype(np.uint8)
    land2[land == 0] = 0
    land = land2
    return dict(land=land, ndvi=ndvi, pndvi=pndvi, valid=valid, pvalid=pvalid, bare=bare, veg=veg, bld=bld,
                ox=ox, oy=oy, shape=shape, nb=nb, nf=nf, water=water)


def candidates(s):
    shape = s['shape']
    ox, oy = s['ox'], s['oy']
    opened = ndimage.binary_opening(s['bare'], structure=np.ones((OPEN_PX, OPEN_PX), bool))
    lab, n = ndimage.label(opened)
    areas = ndimage.sum(np.ones(shape), lab, index=np.arange(1, n + 1)) * 100 / 1e4  # ha
    out = []
    for i in np.flatnonzero(areas >= MIN_DEV_HA) + 1:
        m = lab == i
        ha = float(areas[i - 1])
        pv = s['pvalid'] & m
        if pv.sum() < 0.5 * m.sum():
            continue  # 過去の場面で雲等にかかる部分が多い
        past_veg = float(((s['pndvi'] >= NDVI_VEG) & pv).sum() / pv.sum())
        past_bare = float(((s['pndvi'] < NDVI_BARE) & pv).sum() / pv.sum())
        if past_veg >= 0.6:
            kind = 'dev'      # 造成・伐採・開墾などで、植生から裸地等に変わった候補
        elif past_bare >= 0.6 and ha >= MIN_IDLE_HA:
            kind = 'idle'     # 両年とも裸地等（更地・採石場・採掘跡・駐車場などを含む）
        else:
            continue
        ys, xs = np.nonzero(m)
        cx, cy = ox + (xs.mean() + 0.5) * 10.0, oy - (ys.mean() + 0.5) * 10.0
        mm = m.astype(np.uint8)
        cnts, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cnts, key=cv2.contourArea)
        pts = [(ox + (p[0][0] + 0.5) * 10.0, oy - (p[0][1] + 0.5) * 10.0) for p in cnt]
        if len(pts) < 4:
            continue
        poly = Polygon(pts).buffer(0).simplify(12.0)
        if poly.is_empty or poly.geom_type != 'Polygon':
            continue
        ring = [list(np.round(TO_LL.transform(x, y), 5)) for x, y in poly.exterior.coords]
        lon, lat = TO_LL.transform(cx, cy)
        if not (W + 0.002 < lon < E - 0.002 and S + 0.002 < lat < N - 0.002):
            continue  # 範囲の縁（格子の外にはみ出す）は除く
        out.append(dict(kind=kind, ha=round(ha, 1), lon=round(lon, 5), lat=round(lat, 5), ring=ring,
                        ndvi=round(float(np.nanmean(s['ndvi'][m])), 2), pndvi=round(float(np.nanmean(s['pndvi'][pv])), 2)))
    res = []
    for kind in ('dev', 'idle'):
        res += sorted([c for c in out if c['kind'] == kind], key=lambda c: -c['ha'])[:MAX_EACH]
    for i, c in enumerate(res):
        c['id'] = ('造' if c['kind'] == 'dev' else '遊') + str(sum(1 for t in res[:i + 1] if t['kind'] == c['kind']))
    return res


def to_grid(s):
    """10 m の配列を、緯度経度の格子（NX×NY）に最近傍で。"""
    X, Y = grid_lonlat()
    UX, UY = TO_UTM.transform(X, Y)
    land, ok = sample(s['land'], s['ox'], s['oy'], 10.0, UX, UY)
    land[~ok] = 0
    # 変化: 2020 が植生（NDVI>=0.4）で 2026 が裸地等 → 1。どちらかが雲・欠測は 0
    chg = (s['pvalid'] & s['bare'] & (s['pndvi'] >= NDVI_VEG)).astype(np.uint8)
    chg_g, ok2 = sample(chg, s['ox'], s['oy'], 10.0, UX, UY)
    chg_g[~ok2] = 0
    return land, chg_g


# ---------- OSM 電力設備 ----------
def power_layers(osm_dir):
    d = json.load(open(os.path.join(osm_dir, 'power.json')))
    subs = []
    for el in d['substations']['elements']:
        c = el.get('center') or ({'lat': el['lat'], 'lon': el['lon']} if 'lat' in el else None)
        if not c:
            continue
        t = el.get('tags', {})
        subs.append(dict(lon=round(c['lon'], 5), lat=round(c['lat'], 5), name=t.get('name') or t.get('name:en') or '',
                         voltage=t.get('voltage', ''), kind=t.get('substation', ''), osm=f"{el['type']}/{el['id']}"))
    lines = []
    for el in d['lines']['elements']:
        g = el.get('geometry') or []
        if len(g) < 2:
            continue
        t = el.get('tags', {})
        pts = [(p['lon'], p['lat']) for p in g]
        # 間引き（約 40 m）
        keep = [pts[0]]
        for p in pts[1:-1]:
            if abs(p[0] - keep[-1][0]) * 92000 + abs(p[1] - keep[-1][1]) * 111000 > 40:
                keep.append(p)
        keep.append(pts[-1])
        lines.append(dict(v=t.get('voltage', ''), p=[[round(x, 5), round(y, 5)] for x, y in keep]))
    return subs, lines, d['substations'].get('osm3s', {}).get('timestamp_osm_base', '')


def main():
    ap = argparse.ArgumentParser()
    for k in ('insar', 'sat', 'osm', 'ksj'):
        ap.add_argument('--' + k, required=True)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'dc.js'))
    a = ap.parse_args()
    ksj = ksj_layers(a.ksj)
    sub, cls = insar_layer(a.insar)
    lst_code, lst_c, lst_bad = lst_layer(a.sat)
    s = s2_layers(a.sat, a.osm)
    cands = candidates(s)
    land, chg = to_grid(s)
    subs, lines, osm_ts = power_layers(a.osm)
    lc = lst_c[~lst_bad]
    insar_hist = np.bincount(sub.ravel(), minlength=17).tolist()
    data = dict(
        grid=dict(w=W, s=S, e=E, n=N, d=D, nx=NX, ny=NY),
        layers=dict(flood=rle(ksj['flood']), slide=rle(ksj['slide']), tsunami=rle(ksj['tsunami']), surge=rle(ksj['surge']),
                    sub=rle(sub), lst=rle(lst_code), land=rle(land), chg=rle(chg)),
        labels=dict(tsunami=ksj['tsunami_labels'], surge=ksj['surge_labels']),
        candidates=cands, substations=subs, lines=lines,
        stats=dict(
            lst_p10=round(float(np.percentile(lc, 10)), 1), lst_p50=round(float(np.percentile(lc, 50)), 1), lst_p90=round(float(np.percentile(lc, 90)), 1),
            lst_valid=round(float((~lst_bad).mean()), 3), insar_hist=insar_hist,
            insar_valid=round(float((sub > 0).mean()), 3),
            land_share={str(k): round(float((land == k).mean()), 4) for k in range(6)},
            chg_cells=int(chg.sum()), osm_buildings=s['nb'], osm_building_files=s['nf'], osm_timestamp=osm_ts,
            n_sub=len(subs), n_lines=len(lines)),
    )
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w') as f:
        f.write('window.DC_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote', a.out, os.path.getsize(a.out), 'bytes;', len(cands), 'candidates;', data['stats'])


if __name__ == '__main__':
    main()
