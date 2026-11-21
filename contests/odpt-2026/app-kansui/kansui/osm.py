"""OpenStreetMap（ODbL）から駅・出入口を取る。Overpass API への GET のみ。

出入口は ODPT のトークン不要の公開データに無いため、OSM の railway=subway_entrance /
train_station_entrance を使う。OSM のタグ付けは地域のボランティアによるもので、
全出入口が載っている保証はない。
"""
import json
import os
import time
import urllib.parse
import urllib.request

ENDPOINT = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "kansui-eki-map/0.1 (research; GET only)"}


def query(bbox):
    s, w, n, e = bbox
    bb = f"{s},{w},{n},{e}"
    return (f'[out:json][timeout:90];('
            f'node({bb})["railway"~"^(subway_entrance|train_station_entrance)$"];'
            f'node({bb})["railway"="station"];'
            f'way({bb})["railway"="station"];'
            f');out center tags;')


def fetch(bbox, cache_path=None, retries=4):
    if cache_path and os.path.exists(cache_path):
        return json.load(open(cache_path, encoding="utf-8"))
    url = ENDPOINT + "?data=" + urllib.parse.quote(query(bbox))
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                raw = r.read()
            data = json.loads(raw)
            if cache_path:
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                open(cache_path, "wb").write(raw)
            return data
        except Exception as ex:  # noqa: BLE001
            last = ex
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"Overpass 取得失敗: {last}")


def _pos(e):
    if "lat" in e:
        return e["lat"], e["lon"]
    c = e.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)


def parse(data):
    """-> (stations, entrances)。

    stations: [{osm, name, lat, lon, operator, ref, kind}]  kind は subway / rail
    entrances: [{osm, name, ref, lat, lon, wheelchair}]
    """
    stations, entrances = [], []
    for e in data.get("elements", []):
        t = e.get("tags", {})
        lat, lon = _pos(e)
        if lat is None:
            continue
        rw = t.get("railway", "")
        if rw in ("subway_entrance", "train_station_entrance"):
            entrances.append({"osm": f"{e['type'][0]}{e['id']}", "name": t.get("name", ""),
                              "ref": t.get("ref", ""), "lat": lat, "lon": lon,
                              "wheelchair": t.get("wheelchair", "")})
        elif rw == "station":
            if t.get("station") == "light_rail" and t.get("subway") != "yes":
                kind = "rail"
            elif t.get("station") == "subway" or t.get("subway") == "yes":
                kind = "subway"
            else:
                kind = "rail"
            if not t.get("name"):
                continue
            stations.append({"osm": f"{e['type'][0]}{e['id']}", "name": t["name"], "lat": lat, "lon": lon,
                             "operator": t.get("operator", ""), "ref": t.get("ref", ""), "kind": kind})
    return stations, entrances
