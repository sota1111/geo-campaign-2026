"""駅・出入口・バス停・浸水想定の区分を突き合わせ、画面用のデータを作る（純粋関数）。

区分 cls（0〜6）は hazard.CLASS_LABELS。出入口の区分 = 洪水と高潮の想定のうち大きい方。
  避けたい = 区分2以上（想定浸水深 0.5m 以上）／注意 = 区分1（0.5m 未満）／着色なし = 0
「避けたい」は想定に基づく目安であり、実際の冠水の予測ではない。「着色なし」も安全の保証ではない。
"""
from .geo import haversine_m

AVOID_MIN = 2
WARN_MIN = 1
NEAR_BUS_M = 500
NEAR_STATION_M = 1500
MAX_ALT = 3
MAX_BUS = 5
FAR_STATION_M = 4000   # 近くに区分の低い駅が無いときに、「避けたい」に当たらない出入口を探す範囲
FAR_BUS_M = 1500

# OSM の operator の表記ゆれをそろえる（画面では短い通称で出す）
OPERATOR_FIX = {"東京メト": "東京地下鉄", "JR東日本": "東日本旅客鉄道", "東京急行電鉄": "東急電鉄"}
OPERATOR_DROP = {"Tojoouter"}  # 事業者名として読めない値


def norm_operator(o):
    o = o.strip()
    if not o or o in OPERATOR_DROP:
        return ""
    return OPERATOR_FIX.get(o, o)


def group_stations(stations, merge_m=400):
    """同名の駅ノード（路線ごとに別ノード）を、近ければ1つの駅にまとめる。"""
    groups = []
    for s in sorted(stations, key=lambda x: (x["name"], x["osm"])):
        for g in groups:
            if g["name"] == s["name"] and haversine_m(g["lat"], g["lon"], s["lat"], s["lon"]) <= merge_m:
                g["nodes"].append(s)
                n = len(g["nodes"])
                g["lat"] += (s["lat"] - g["lat"]) / n
                g["lon"] += (s["lon"] - g["lon"]) / n
                break
        else:
            groups.append({"name": s["name"], "lat": s["lat"], "lon": s["lon"], "nodes": [s]})
    return groups


def assign_entrances(groups, entrances, near_m=300, name_m=600):
    """出入口を駅に割り当てる。名前に駅名を含むなら name_m 以内、そうでなければ最寄りの near_m 以内。
    割り当てられない出入口は unassigned に入れる。"""
    by = [[] for _ in groups]
    unassigned = []
    for e in entrances:
        best = None
        for gi, g in enumerate(groups):
            d = haversine_m(g["lat"], g["lon"], e["lat"], e["lon"])
            named = bool(g["name"]) and g["name"] in (e.get("name") or "")
            lim = name_m if named else near_m
            if d <= lim:
                key = (0 if named else 1, d)
                if best is None or key < best[0]:
                    best = (key, gi)
        if best is None:
            unassigned.append(e)
        else:
            by[best[1]].append(e)
    return by, unassigned


def cls_of(hz):
    return max(hz.get("flood", 0), hz.get("tide", 0))


def status_of(c):
    return "avoid" if c >= AVOID_MIN else ("warn" if c >= WARN_MIN else "none")


def _label(e, i):
    if e.get("ref"):
        return f"出入口 {e['ref']}"
    return f"出入口 {i + 1}"


def build_dataset(stations, entrances, bus_stops, sampler):
    """sampler(lon, lat) -> {"flood": int, "tide": int}。"""
    groups = group_stations(stations)
    by, unassigned = assign_entrances(groups, entrances)

    buses = []
    for b in bus_stops:
        hz = sampler(b["lon"], b["lat"])
        buses.append({**b, "flood": hz["flood"], "tide": hz["tide"], "cls": cls_of(hz)})

    st_out = []
    for g, ents in zip(groups, by):
        hz = sampler(g["lon"], g["lat"])
        ents_sorted = sorted(ents, key=lambda e: (e.get("ref") or "~", e["osm"]))
        ent_out = []
        for i, e in enumerate(ents_sorted):
            ehz = sampler(e["lon"], e["lat"])
            ent_out.append({"id": e["osm"], "label": _label(e, i), "name": e.get("name", ""),
                            "ref": e.get("ref", ""), "lat": round(e["lat"], 6), "lon": round(e["lon"], 6),
                            "wheelchair": e.get("wheelchair", ""),
                            "flood": ehz["flood"], "tide": ehz["tide"], "cls": cls_of(ehz)})
        ops = sorted({norm_operator(o) for n in g["nodes"] for o in n["operator"].split(";")} - {""})
        st_out.append({"id": g["nodes"][0]["osm"], "name": g["name"], "lat": round(g["lat"], 6),
                       "lon": round(g["lon"], 6), "operators": ops,
                       "kinds": sorted({n["kind"] for n in g["nodes"]}),
                       "flood": hz["flood"], "tide": hz["tide"], "cls": cls_of(hz),
                       "entrances": ent_out})

    # 駅ごとの要約
    for s in st_out:
        cl = [e["cls"] for e in s["entrances"]]
        s["summary"] = {"n": len(cl), "avoid": sum(c >= AVOID_MIN for c in cl),
                        "warn": sum(WARN_MIN <= c < AVOID_MIN for c in cl),
                        "none": sum(c < WARN_MIN for c in cl), "max": max(cl) if cl else None}

    def near_bus(lat, lon):
        arr = []
        for bi, b in enumerate(buses):
            if b["wd"] <= 0 and b["hol"] <= 0:
                continue
            d = haversine_m(lat, lon, b["lat"], b["lon"])
            if d <= NEAR_BUS_M:
                arr.append({"b": bi, "d": round(d)})
        arr.sort(key=lambda x: (x["d"], x["b"]))
        return arr[:MAX_BUS]

    def safer_options(si, e):
        """「避けたい」に当たらない（区分 AVOID_MIN 未満）最寄りの駅の出入口とバス停。近くに無い地域でも示すため範囲を広げる。
        あわせて、着色なし（区分0）で最寄りのものも返す（station0 / bus0）。"""
        def nearest_station(maxc):
            best = None
            for sj, t in enumerate(st_out):
                if sj == si:
                    continue
                pts = [(o["lat"], o["lon"], o["cls"], oi) for oi, o in enumerate(t["entrances"])] or [(t["lat"], t["lon"], t["cls"], -1)]
                for la, lo, c, oi in pts:
                    if c > maxc:
                        continue
                    d = haversine_m(e["lat"], e["lon"], la, lo)
                    if d <= FAR_STATION_M and (best is None or d < best[0]):
                        best = (d, sj, oi)
            return None if best is None else {"s": best[1], "e": best[2], "d": round(best[0])}

        def nearest_bus(maxc):
            bb = None
            for bi, b in enumerate(buses):
                if (b["wd"] <= 0 and b["hol"] <= 0) or b["cls"] > maxc:
                    continue
                d = haversine_m(e["lat"], e["lon"], b["lat"], b["lon"])
                if d <= FAR_BUS_M and (bb is None or d < bb[0]):
                    bb = (d, bi)
            return None if bb is None else {"b": bb[1], "d": round(bb[0])}

        out = {"station": nearest_station(AVOID_MIN - 1), "bus": nearest_bus(AVOID_MIN - 1)}
        s0, b0 = nearest_station(0), nearest_bus(0)
        if s0 != out["station"]:
            out["station0"] = s0
        if b0 != out["bus"]:
            out["bus0"] = b0
        return out

    # 代わりの候補
    for si, s in enumerate(st_out):
        s["bus"] = near_bus(s["lat"], s["lon"])
        for ei, e in enumerate(s["entrances"]):
            alt = {"same": [], "stations": [], "bus": near_bus(e["lat"], e["lon"])}
            if e["cls"] >= WARN_MIN:
                same = [(o["cls"], haversine_m(e["lat"], e["lon"], o["lat"], o["lon"]), oi)
                        for oi, o in enumerate(s["entrances"]) if oi != ei and o["cls"] < e["cls"]]
                same.sort()
                alt["same"] = [{"i": oi, "d": round(d)} for _, d, oi in same[:MAX_ALT]]
                cands = []
                for sj, t in enumerate(st_out):
                    if sj == si or t["name"] == s["name"]:
                        continue
                    opts = [(o["cls"], haversine_m(e["lat"], e["lon"], o["lat"], o["lon"]), oi)
                            for oi, o in enumerate(t["entrances"])]
                    if not opts:
                        opts = [(t["cls"], haversine_m(e["lat"], e["lon"], t["lat"], t["lon"]), -1)]
                    c, d, oi = min(opts)  # 区分の低い出入口、同じなら近い方
                    if c < e["cls"] and d <= NEAR_STATION_M:
                        cands.append((d, c, sj, oi))
                cands.sort()
                alt["stations"] = [{"s": sj, "e": oi, "d": round(d)} for d, c, sj, oi in cands[:MAX_ALT]]
            if e["cls"] >= AVOID_MIN:
                alt["safer"] = safer_options(si, e)
            e["alt"] = alt
    return {"stations": st_out, "bus": buses, "unassigned_entrances": len(unassigned)}


def rank_stations(stations):
    """「浸水想定のある出入口が多い駅」の順。避けたい出入口の数 → 注意を含む数 → 最大区分 → 駅名。"""
    rows = [s for s in stations if s["summary"]["n"] > 0]
    return sorted(rows, key=lambda s: (-s["summary"]["avoid"], -(s["summary"]["avoid"] + s["summary"]["warn"]),
                                       -(s["summary"]["max"] or 0), s["name"]))
