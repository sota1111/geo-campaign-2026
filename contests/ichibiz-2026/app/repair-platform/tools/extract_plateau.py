"""PLATEAU 東京23区（2022年度）CityGML から、1区（既定: 墨田区 13107）の建物を取り出して web/data/buildings.json を作る。

- 取得は HTTP Range の GET のみ（tools/remotezip.py）。ZIP 全体は取らず、区に重なる 3次メッシュ（約1km）の bldg だけを読む。
- 読むのは: 建物ID、計測高さ(measuredHeight)、屋根外形(lod0RoofEdge)、住所(LocalityName)、名称(gml:name)、
  建築年・階数・延床面積・用途（標準仕様にある属性。入っていれば拾う）。
- 付与率は、区の全建物に対して、各属性が入っている建物の割合を数えて stats に書く。
- 地図に出す「共同住宅らしい規模」の建物（高さと屋根面積で選ぶ。用途の属性ではない）だけを buildings に書く。
使い方: python3 -I tools/extract_plateau.py [--ward=13107]
"""
import json
import math
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from remotezip import open_zip, PLATEAU_CITYGML_URL  # noqa: E402

WARD = "13107"
for a in sys.argv[1:]:
    if a.startswith("--ward="):
        WARD = a.split("=")[1]
WARD_NAME = {"13107": "墨田区"}.get(WARD, WARD)
# 墨田区をおおよそ覆う範囲（経度・緯度）。メッシュの選び方だけに使い、建物の所属は建物ID・住所の区コードで決める
BBOX = {"13107": (139.790, 35.685, 139.870, 35.745)}[WARD]
# 地図に出す候補の条件（用途の属性ではなく、規模で選ぶ。画面にも書く）
MIN_H = 12.0
MIN_AREA = 150.0
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data", "buildings.json")


def mesh_box(code):
    p, q, r, s, t, u = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7])
    lat0 = p / 1.5 + r / 12 + t / 120
    lon0 = 100 + q + s / 8 + u / 80
    return lon0, lat0, lon0 + 1 / 80, lat0 + 1 / 120


def local(tag):
    return tag.split("}")[1] if "}" in tag else tag


def ring_metrics(coords):
    """coords: [(lat, lon)]。平面近似（緯度で補正した等距円筒）で面積(㎡)・周長(m)・重心を返す。"""
    lat0 = sum(c[0] for c in coords) / len(coords)
    kx = 111320 * math.cos(math.radians(lat0))
    ky = 110574
    pts = [((lon) * kx, (lat) * ky) for lat, lon in coords]
    area2 = 0.0
    per = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        area2 += x1 * y2 - x2 * y1
        per += math.hypot(x2 - x1, y2 - y1)
    return abs(area2) / 2, per


def simplify(coords, tol_m=0.8):
    """近すぎる点を落として点数を減らす（地図表示用）。閉じた環の先頭=末尾は保つ。"""
    if len(coords) <= 5:
        return coords
    out = [coords[0]]
    for c in coords[1:-1]:
        if math.hypot((c[0] - out[-1][0]) * 110574, (c[1] - out[-1][1]) * 91000) >= tol_m:
            out.append(c)
    out.append(coords[-1])
    return out if len(out) >= 4 else coords


def parse_building(el):
    d = {"id": None, "city": None, "h": None, "roofArea": None, "town": None, "name": None, "year": None, "floors": None, "tfa": None, "usage": None, "ring": None}
    for e in el.iter():
        t = local(e.tag)
        txt = (e.text or "").strip()
        if t == "buildingID" and txt:
            d["id"] = txt
        elif t == "city" and txt and d["city"] is None:
            d["city"] = txt
        elif t == "measuredHeight" and txt:
            d["h"] = float(txt)
        elif t == "buildingRoofEdgeArea" and txt:
            d["roofArea"] = float(txt)
        elif t == "LocalityName" and txt:
            d["town"] = txt
        elif t == "name" and txt and e.tag.endswith("}name") and "gml" in e.tag and d["name"] is None:
            d["name"] = txt
        elif t == "yearOfConstruction" and txt:
            d["year"] = txt
        elif t == "storeysAboveGround" and txt:
            d["floors"] = txt
        elif t == "totalFloorArea" and txt:
            d["tfa"] = txt
        elif t == "usage" and txt:
            d["usage"] = txt
    for e in el.iter():
        if local(e.tag) == "lod0RoofEdge":
            for pl in e.iter():
                if local(pl.tag) == "posList" and pl.text:
                    v = [float(x) for x in pl.text.split()]
                    d["ring"] = [(v[i], v[i + 1]) for i in range(0, len(v) - 2, 3)]
                    break
            break
    return d


def main():
    z = open_zip()
    infos = [i for i in z.infolist() if "/bldg/" in i.filename and i.filename.endswith(".gml")]
    x0, y0, x1, y1 = BBOX
    sel = []
    for i in infos:
        code = os.path.basename(i.filename)[:8]
        a, b, c, d = mesh_box(code)
        if a < x1 and c > x0 and b < y1 and d > y0:
            sel.append(i)
    print("meshes", len(sel), file=sys.stderr)
    stats = {"total": 0, "height": 0, "roofArea": 0, "town": 0, "name": 0, "year": 0, "floors": 0, "tfa": 0, "usage": 0}
    cands = []
    seen = set()
    towns = {}
    for k, info in enumerate(sel):
        with z.open(info.filename) as f:
            for ev, el in ET.iterparse(f, events=("end",)):
                if local(el.tag) != "Building":
                    continue
                d = parse_building(el)
                el.clear()
                code = (d["city"] or "") if d["city"] else (d["id"] or "")[:5]
                if not str(code).startswith(WARD) or d["id"] in seen:
                    continue
                seen.add(d["id"])
                stats["total"] += 1
                for key, sk in (("h", "height"), ("roofArea", "roofArea"), ("town", "town"), ("name", "name"), ("year", "year"), ("floors", "floors"), ("tfa", "tfa"), ("usage", "usage")):
                    if d[key] is not None:
                        stats[sk] += 1
                if not d["ring"] or d["h"] is None:
                    continue
                area, per = ring_metrics(d["ring"])
                if d["h"] >= MIN_H and area >= MIN_AREA:
                    town = (d["town"] or "").replace("東京都", "").replace(WARD_NAME, "")
                    ring = simplify(d["ring"])
                    lat = sum(p[0] for p in d["ring"][:-1]) / max(1, len(d["ring"]) - 1)
                    lon = sum(p[1] for p in d["ring"][:-1]) / max(1, len(d["ring"]) - 1)
                    cands.append({
                        "id": d["id"], "lat": round(lat, 6), "lon": round(lon, 6), "h": round(d["h"], 1),
                        "area": round(area, 0), "per": round(per, 0), "town": town, "name": d["name"],
                        "ring": [[round(p[1], 5), round(p[0], 5)] for p in ring],
                    })
                towns[d["town"]] = 1
        print(k + 1, "/", len(sel), os.path.basename(info.filename), stats["total"], len(cands), file=sys.stderr)
    out = {
        "meta": {
            "ward": WARD_NAME, "wardCode": WARD,
            "source": "3D都市モデル（Project PLATEAU）東京都23区（2022年度）CityGML（v2）建築物モデル（LOD1）。国土交通省。G空間情報センター（https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-2022）",
            "sourceUrl": PLATEAU_CITYGML_URL,
            "license": "PLATEAU Site Policy「3．著作権について」に拠る（https://www.mlit.go.jp/plateau/site-policy/）。加工して作成。",
            "meshCount": len(sel), "minHeight": MIN_H, "minArea": MIN_AREA,
            # tools/peek.py --every=20 の実測（東京23区の全 671 メッシュから 34 メッシュを等間隔に抽出）。建築年・階数・延床・用途は1棟も入っていなかった
            "sample": {"meshes": 34, "buildings": 84395, "withYearFloorsAreaUsage": 0, "method": "tools/peek.py --every=20（2026-11-22 実行）"},
        },
        "stats": stats,
        "buildings": cands,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(stats, ensure_ascii=False), "candidates", len(cands), file=sys.stderr)


if __name__ == "__main__":
    main()
