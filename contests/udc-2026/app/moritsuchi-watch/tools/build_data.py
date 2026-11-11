"""A54-23_22.xml（国土数値情報 大規模盛土造成地 静岡県）から、対象2市（熱海市・伊東市）の
GeoJSON を作る。座標は小数5桁に丸める（約1m）。
使い方: python3 -I tools/build_data.py <A54-23_22.xml> <出力 data/fills.geojson>
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = {
    "ksj": "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app",
    "gml": "http://schemas.opengis.net/gml/3.2.1",
    "xlink": "http://www.w3.org/1999/xlink",
}
XLINK = "{http://www.w3.org/1999/xlink}href"
GMLID = "{http://schemas.opengis.net/gml/3.2.1}id"
TARGETS = ["熱海市", "伊東市"]
KIND = {"1": "谷埋め型", "2": "腹付け型", "9": "区分なし"}


def build(xml_path):
    root = ET.parse(xml_path).getroot()
    curves = {}
    for c in root.findall("gml:Curve", NS):
        txt = c.find(".//gml:posList", NS).text.split()
        vals = [float(v) for v in txt]
        # 元データは「緯度 経度」の順
        pts = [[round(vals[i + 1], 5), round(vals[i], 5)] for i in range(0, len(vals), 2)]
        curves[c.get(GMLID)] = pts
    surfaces = {}
    for s in root.findall("gml:Surface", NS):
        ref = s.find(".//gml:exterior//gml:curveMember", NS).get(XLINK)[1:]
        surfaces[s.get(GMLID)] = curves[ref]
    feats = []
    for f in root.findall("ksj:LargeScaleFillSlope", NS):
        name = f.find("ksj:localGovernmentName", NS).text
        if name not in TARGETS:
            continue
        ring = surfaces[f.find("ksj:bounds", NS).get(XLINK)[1:]]
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        feats.append({
            "type": "Feature",
            "properties": {
                "id": f.find("ksj:fillSlopeNumber", NS).text,
                "city": name,
                "kind": KIND[f.find("ksj:fillSlopeClassification", NS).text],
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    return {"type": "FeatureCollection", "features": feats}


if __name__ == "__main__":
    fc = build(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as fp:
        json.dump(fc, fp, ensure_ascii=False, separators=(",", ":"))
    print(len(fc["features"]), "features")
