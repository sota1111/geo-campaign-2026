"""区画の中心点の市区町村コードを、国土地理院の逆ジオコーダ（GET）で調べて data/muni.js に書く。

  python3 tools/fetch_muni.py   （proposal-sugi/ で実行。1件ごとに0.15秒あける）
出典: 国土地理院 逆ジオコーディングAPI https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress
"""
import json, os, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = {"13205": "青梅市", "13228": "あきる野市", "13305": "日の出町", "13227": "羽村市", "13303": "瑞穂町",
         "13307": "檜原村", "13308": "奥多摩町", "13218": "福生市", "11209": "飯能市", "11225": "入間市", "11242": "日高市"}


def main():
    s = open(os.path.join(ROOT, "data", "data.js"), encoding="utf-8").read()
    d = json.loads(s[s.index("{"):s.rindex("}") + 1])
    out = {}
    for c in d["cells"]:
        code, lat, lon = c[0], c[4], c[5]
        url = f"https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lon}"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "geo-campaign-demo"}), timeout=30) as r:
            res = json.load(r).get("results") or {}
        m = res.get("muniCd", "")
        out[code] = [m, NAMES.get(m, m), res.get("lv01Nm", "")]
        time.sleep(0.15)
    with open(os.path.join(ROOT, "data", "muni.js"), "w", encoding="utf-8") as f:
        f.write("// tools/fetch_muni.py が生成。区画中心点の市区町村（国土地理院 逆ジオコーダ、" + time.strftime("%Y-%m-%d") + " 取得）。手で編集しない。\n")
        f.write("window.SUGI_MUNI = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(len(out), "cells")


if __name__ == "__main__":
    main()
