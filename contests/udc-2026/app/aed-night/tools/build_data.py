#!/usr/bin/env python3
"""AED CSV・行政区域・地域メッシュ統計から、アプリ用の data/aed.json と data/boundaries.geojson を作る。

usage: python3 -I tools/build_data.py <fetch_raw.py の作業ディレクトリ> <出力ディレクトリ(data)>
要: shapely（pip）。町丁目名の付与に国土地理院の逆ジオコーダ（GET、結果は <作業ディレクトリ>/geocode_cache.json に保存）を使う。

出力 aed.json:
  munis: 自治体ごとの出典・件数・時間表記の集計
  aed:   [muni番号, 緯度, 経度, 名称, 設置位置, 種別(0=24時間/1=時間指定/2=不明/3=曜日を毎日と仮定した時間指定/4=一般の人が使えない設置位置（救急車内・病棟・職員室など）), 窓 or 理由コード,
          特記事項(0=なし/1=あり・曜日と時間には反映できなかった/2=あり・曜日と時間に反映した。祝日・年末年始・第N週は未反映), 座標が市の範囲外(0/1。市境から約1km超。除外せず印を付けて数える)]
         窓 = [[曜日ビット(月=1,火=2,…,日=64), 開始分, 終了分], ...]
  cells: [muni番号, メッシュコード, 中心緯度, 中心経度, 人口, 境界付近(0/1), 地区番号]
  areas: 地区名（逆ジオコーダが返した町丁目名。500mメッシュ中心の住所なので目安）
"""
import csv
import io
import json
import math
import re
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union
from shapely.prepared import prep

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import aed_time  # noqa: E402

UA = {"User-Agent": "udc2026-aed-night/0.1 (research; GET only)"}
EDGE_M = 800  # 境界からこの距離以内の地区は、隣の自治体のAEDが入っていないため過大評価の可能性
REVGEO = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon={lon}&lat={lat}"
KIND = {"24h": 0, "timed": 1, "unknown": 2}
NOTE_CODE = {"none": 0, "noted": 1, "applied": 2, "conditional": 1}


def mesh_center(code):
    """メッシュコード(10桁=250m)から中心の (lat, lon)。500mは9桁、1kmは8桁。"""
    p, q, r, s = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5])
    u, v = int(code[6]), int(code[7])
    lat = p / 1.5 + r * (5 / 60) + u * (30 / 3600)
    lon = 100 + q + s * (7.5 / 60) + v * (45 / 3600)
    h, w = 30 / 3600, 45 / 3600
    for ch in code[8:]:
        h, w = h / 2, w / 2
        n = int(ch) - 1
        lat += (n // 2) * h
        lon += (n % 2) * w
    return lat + h / 2, lon + w / 2


def days_mask(windows):
    """[[曜日,開始,終了],...] → 同じ(開始,終了)の曜日をビットにまとめる"""
    g = {}
    for d, s, e in windows:
        g.setdefault((s, e), 0)
        g[(s, e)] |= 1 << d
    return [[m, s, e] for (s, e), m in sorted(g.items(), key=lambda kv: (kv[0]))]


def read_csv(path, enc):
    return list(csv.DictReader(io.StringIO(Path(path).read_text(encoding=enc))))


def load_aeds(m, work, assume):
    rows = read_csv(work / f"aed_{m['id']}.csv", m["encoding"])
    out = []
    for x in rows:
        try:
            if m["format"] == "fukuoka":
                lat, lon = float(x["緯度"]), float(x["経度"])
                free = x["フリースペース"]
                mm = re.search(r"使用時間[：:](.*)", free, re.S)
                avail = aed_time.parse_availability("", "", "", (mm.group(1) if mm else free).strip(), assume)
                mp = re.search(r"設置場所[：:]([^\n]*)", free)
                rec = {"name": x["名称"].strip(), "place": mp.group(1).strip() if mp else "",
                       "note": 1 if (mm and re.search(r"[（(〔].*[）)〕]", mm.group(1))) else 0, "nstat": "none"}
            else:
                lat, lon = float(x["緯度"]), float(x["経度"])
                avail = aed_time.parse_availability(x["利用可能曜日"], x["開始時間"], x["終了時間"], "", assume)
                note_text = x.get("利用可能日時特記事項", "").strip()
                avail, nstat = aed_time.apply_special_note(avail, note_text)
                rec = {"name": x["名称"].strip(), "place": x.get("設置位置", "").strip(), "note": NOTE_CODE[nstat], "nstat": nstat}
        except (ValueError, KeyError):
            out.append(None)  # 緯度経度なし
            continue
        if not (20 < lat < 46 and 122 < lon < 154):
            out.append(None)
            continue
        avail, access = aed_time.classify_access(rec["name"], rec["place"], avail)
        rec.update(lat=round(lat, 5), lon=round(lon, 5), avail=avail, access=access)
        out.append(rec)
    return rows, out


def load_boundary(m, work):
    geoms, names = [], {}
    for bid in m["boundaries"]:
        d = json.loads((work / f"boundary_{bid}.geojson").read_text(encoding="utf-8"))
        for f in d["features"]:
            geoms.append(shape(f["geometry"]))
            names[f["properties"].get("N03_007", "")] = f["properties"].get("N03_004", "")
    return unary_union(geoms), names


def load_mesh(m, work, sid):
    z = zipfile.ZipFile(work / f"mesh_{sid}_{m['mesh1']}.zip")
    text = z.read(z.namelist()[0]).decode("cp932")
    cells = {}
    for i, row in enumerate(csv.reader(io.StringIO(text))):
        if i < 2 or not row or not row[0]:
            continue
        if len(row[0]) != 10:
            continue
        try:
            pop = int(row[4])
        except ValueError:
            continue  # 「*」（秘匿）は人口不明として除く
        if pop > 0:
            cells[row[0]] = pop
    return cells


def revgeo(lat, lon, cache, cpath):
    key = f"{lat:.5f},{lon:.5f}"
    if key in cache:
        return cache[key]
    for attempt in range(3):
        try:
            req = urllib.request.Request(REVGEO.format(lat=lat, lon=lon), headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                res = json.loads(r.read()).get("results") or {}
            cache[key] = {"cd": res.get("muniCd", ""), "nm": res.get("lv01Nm", "")}
            break
        except Exception:
            time.sleep(1 + attempt)
    else:
        cache[key] = {"cd": "", "nm": ""}
    time.sleep(0.05)
    return cache[key]


def main():
    work, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    src = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))
    cpath = work / "geocode_cache.json"
    cache = json.loads(cpath.read_text(encoding="utf-8")) if cpath.exists() else {}
    munis, aeds, cells_out, areas, area_idx, bfeatures = [], [], [], [], {}, []
    for mi, m in enumerate(src["municipalities"]):
        poly, ward_names = load_boundary(m, work)
        lat0 = poly.centroid.y
        kx, ky = 111320 * math.cos(math.radians(lat0)), 110574
        to_m = lambda x, y, z=None: (x * kx, y * ky)  # noqa: E731
        poly_m = transform(to_m, poly)
        pprep = prep(poly)
        rows_strict, parsed_strict = load_aeds(m, work, False)
        _, parsed_assume = load_aeds(m, work, True)
        # 集計（曜日の仮定なし／あり）。登録数は名称のある行（元CSVには名称も座標も空の行が含まれることがある）
        total = sum(1 for r in rows_strict if (r.get("名称") or "").strip())
        blank_rows = len(rows_strict) - total
        with_xy = sum(1 for p in parsed_strict if p)
        reasons, kinds = {}, {"24h": 0, "timed": 0, "unknown": 0, "nonpublic": 0}
        kinds_a = {"24h": 0, "timed": 0, "unknown": 0, "nonpublic": 0}
        notes = {"none": 0, "noted": 0, "applied": 0, "conditional": 0}
        for p, pa in zip(parsed_strict, parsed_assume):
            if not p:
                continue
            notes[p["nstat"]] += 1
            if p["access"] == "nonpublic":
                kinds["nonpublic"] += 1
                kinds_a["nonpublic"] += 1
                continue
            kinds[p["avail"]["kind"]] += 1
            kinds_a[pa["avail"]["kind"]] += 1
            if p["avail"]["kind"] == "unknown":
                reasons[p["avail"]["reason"]] = reasons.get(p["avail"]["reason"], 0) + 1
        n_assumed = sum(1 for p in parsed_assume if p and p["avail"]["assumed"] and p["access"] == "public")
        for p, pa in zip(parsed_strict, parsed_assume):
            if not p:
                continue
            a_s, a_a = p["avail"], pa["avail"]
            if p["access"] == "nonpublic":
                kind, payload = 4, "nonpublic"
            elif a_s["kind"] != "unknown":
                kind = KIND[a_s["kind"]]
                payload = [] if a_s["kind"] == "24h" else days_mask(a_s["windows"])
            elif a_a["kind"] != "unknown":
                kind, payload = 3, days_mask(a_a["windows"])  # 曜日を毎日と仮定した場合だけ使える
            else:
                kind, payload = 2, a_s["reason"]
            aeds.append([mi, p["lat"], p["lon"], p["name"], p["place"], kind, payload, p["note"], 0 if pprep.contains(Point(p["lon"], p["lat"])) or poly.distance(Point(p["lon"], p["lat"])) < 0.01 else 1])
        # メッシュ
        cells = load_mesh(m, work, src["mesh_stats_id"])
        sel = []
        for code, pop in cells.items():
            lat, lon = mesh_center(code)
            if pprep.contains(Point(lon, lat)):
                d = poly_m.boundary.distance(Point(lon * kx, lat * ky))
                sel.append((code, lat, lon, pop, 1 if d < EDGE_M else 0))
        # 地区名（500mメッシュ=コード9桁の中心を逆ジオコーダに問う）
        parents = sorted({c[0][:9] for c in sel})
        print(m["name"], "AED", total, "メッシュ", len(sel), "逆ジオコーダ", len(parents), flush=True)
        labels = {}
        todo = [pc for pc in parents if "%.5f,%.5f" % mesh_center(pc) not in cache]
        with ThreadPoolExecutor(max_workers=5) as ex:  # 国土地理院へは同時5接続まで
            list(ex.map(lambda pc: revgeo(*mesh_center(pc), cache, cpath), todo))
        for pc in parents:
            la, lo = mesh_center(pc)
            r = revgeo(la, lo, cache, cpath)
            nm = r["nm"] or "（住所不明）"
            if m["format"] == "fukuoka" and r["cd"] in ward_names:
                nm = ward_names[r["cd"]] + " " + nm
            labels[pc] = nm
        for code, lat, lon, pop, edge in sel:
            nm = labels[code[:9]]
            key = (mi, nm)
            if key not in area_idx:
                area_idx[key] = len(areas)
                areas.append(nm)
            cells_out.append([mi, code, round(lat, 5), round(lon, 5), pop, edge, area_idx[key]])
        simp = poly.simplify(0.0004, preserve_topology=True)
        bfeatures.append({"type": "Feature", "properties": {"id": m["id"], "name": m["name"]},
                          "geometry": json.loads(json.dumps(simp.__geo_interface__))})
        minx, miny, maxx, maxy = poly.bounds
        munis.append({
            "id": m["id"], "name": m["name"], "pref": m["pref"], "code": m["code"], "format": m["format"],
            "bbox": [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)],
            "dataset": m["dataset"], "landing": m["landing"], "license": m["license"], "credit": m["credit"],
            "rows": total, "blank_rows": blank_rows, "with_xy": with_xy,
            "kinds": kinds, "kinds_if_everyday": kinds_a, "assumed_days": n_assumed, "unknown_reasons": reasons, "notes": notes,
            "out_of_range": sum(1 for a in aeds if a[0] == mi and a[8]), "cells": len(sel), "pop": sum(c[3] for c in sel),
            "edge_cells": sum(1 for c in sel if c[4]), "edge_pop": sum(c[3] for c in sel if c[4]),
        })
    cpath.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    meta = {"mesh": src["mesh_note"], "edge_m": EDGE_M, "areas": areas, "munis": munis, "aed": aeds, "cells": cells_out}
    (outdir / "aed.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (outdir / "boundaries.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": bfeatures}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for mu in munis:
        print(json.dumps(mu, ensure_ascii=False))


if __name__ == "__main__":
    main()
