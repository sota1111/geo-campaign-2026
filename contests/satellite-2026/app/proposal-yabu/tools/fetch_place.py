"""候補区画の中心点の大字・町名を、国土地理院の逆ジオコーダ（GET）で調べて data/place.js に書く。

  python3 tools/fetch_place.py   （proposal-yabu/ で実行。1件ごとに0.15秒あける）
出典: 国土地理院 逆ジオコーディングAPI https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress
"""
import json, os, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    s = open(os.path.join(ROOT, "data", "yabu.js"), encoding="utf-8").read()
    d = json.loads(s[s.index("{"):s.rindex("}") + 1])
    out = {}
    for c in d["cells"]:
        url = f"https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={c['lat']}&lon={c['lon']}"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "geo-campaign-demo"}), timeout=30) as r:
            res = json.load(r).get("results") or {}
        out[c["id"]] = [res.get("muniCd", ""), res.get("lv01Nm", "")]
        time.sleep(0.15)
    with open(os.path.join(ROOT, "data", "place.js"), "w", encoding="utf-8") as f:
        f.write("// tools/fetch_place.py が生成。区画中心点の大字・町名（国土地理院 逆ジオコーダ、" + time.strftime("%Y-%m-%d") + " 取得）。手で編集しない。\n")
        f.write("window.YABU_PLACE = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(len(out), "cells")


if __name__ == "__main__":
    main()
