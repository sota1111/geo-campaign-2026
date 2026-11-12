"""前処理: 取得済みデータ → web/data/*.json。

python3 -m lifemap.build [--today YYYY-MM-DD] [--region ID] [--whatif-top N]
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path

from . import access, fetch, sources
from .gtfs import DAYTYPES, load_feed
from .network import Network

ROOT = Path(__file__).resolve().parent.parent
DIAG_RADIUS_M = 2000   # 診断対象 = 収録停留所からこの距離以内の人口メッシュ
WHATIF_TOP = 100000   # 「路線を止めたら」を事前計算する路線数の上限（便数の多い順。実質すべての路線）
FACILITY_LABELS = {"hospital": "病院", "school": "小・中学校"}
PUBLIC_END = dt.date(2027, 3, 12)   # チャレンジ開催期間の終わり（成果物を公開し続ける期限）。これより前に切れるデータは警告する
MODE_LABELS = {0: "路面電車", 1: "地下鉄", 2: "鉄道", 3: "バス", 4: "フェリー", 5: "ケーブルカー", 6: "ロープウェイ", 7: "ケーブルカー"}


def fmt_date(d):
    return d.isoformat() if d else None


def feed_meta_index(feeds_json_path):
    body = json.loads(Path(feeds_json_path).read_text(encoding="utf-8"))["body"]
    return {(f["organization_id"], f["feed_id"]): f for f in body}


def r5(x):
    return round(x, 5)


def mode_label(t):
    """GTFS の route_type（拡張型を含む）-> 表示名。"""
    if t in MODE_LABELS:
        return MODE_LABELS[t]
    if 100 <= t < 200:
        return "鉄道"
    if 200 <= t < 300 or 700 <= t < 800:
        return "バス"
    if 400 <= t < 500:
        return "地下鉄"
    if 900 <= t < 1000:
        return "路面電車"
    if 1000 <= t < 1100:
        return "フェリー"
    return "その他"


def feed_meta(f, key, meta_idx):
    """regions.json の feeds の1要素 -> メタ情報 dict（GTFSデータリポジトリは feeds.json、ODPTは regions.json 内の記述）。"""
    return f if isinstance(f, dict) else meta_idx.get(key, {})


def group_routes(net, feed_orgs):
    """GTFS の route_id を、利用者が同じ「路線」と呼ぶ単位（事業者・路線名・副名）にまとめる。

    戻り値: (group_of[route_idx] -> group_idx, members[group_idx] -> [route_idx], keys[group_idx] -> (事業者, 名称, 副名))
    名称は route_short_name、無ければ route_long_name、無ければ route_id。副名は short があるときの long。
    """
    index, group_of, members, keys = {}, [], [], []
    for ridx, (fi, rid, short, long_, _color) in enumerate(net.routes):
        key = (feed_orgs[fi], short or long_ or rid, long_ if short else "")
        if key not in index:
            index[key] = len(keys)
            keys.append(key)
            members.append([])
        g = index[key]
        group_of.append(g)
        members[g].append(ridx)
    return group_of, members, keys


def prune_patterns(pats):
    """同じ路線の系統パターンのうち、他のパターンに含まれる（停留所集合が部分集合の）ものを省く。"""
    pats = sorted(pats, key=lambda p: -len(p))
    kept = []
    for p in pats:
        sp = set(p)
        if not any(sp <= set(q) for q in kept):
            kept.append(p)
    return kept


def loaded_feed_defs(reg, paths):
    """regions.json の feeds のうち、取得できた（paths['feed'] にある）もの。トークン必須で飛ばしたものは除く。"""
    return [f for f in reg["feeds"] if fetch.feed_key(f) in paths["feed"]]


def covered_rail(reg, paths):
    """GTFSに収録済みの鉄道 [(運営会社, 路線名 or None)]。地域の rail_covered と、読み込めたフィードの rail_covered。"""
    out = [tuple(c) for c in reg.get("rail_covered") or []]
    for f in loaded_feed_defs(reg, paths):
        if isinstance(f, dict):
            out += [tuple(c) for c in f.get("rail_covered") or []]
    return out


def rail_stations(reg, paths):
    """GTFSに無い鉄道の駅（国土数値情報 N02）。収録済みの事業者・路線（covered_rail）は除く。
    戻り値 [(lat, lon, 駅名, 運営会社)]（同じ事業者・駅名は1つにまとめる）。paths['rail'] が無ければ None。"""
    if not paths.get("rail"):
        return None
    covered = covered_rail(reg, paths)
    seen = {}
    for lat, lon, name, op, line in sources.read_rail_stations(paths["rail"], reg["bbox"]):
        if any(op == c_op and (c_line is None or c_line == line) for c_op, c_line in covered):
            continue
        seen.setdefault((op, name), (lat, lon, name, op))
    return sorted(seen.values())


def updated_from_version(version):
    """feed_version から更新日。先頭8桁が日付ならそれ、無ければ文字列中の 20YYMMDD（例: edo_20260715_001）。"""
    v = (version or "")[:8]
    if len(v) == 8 and v.isdigit():
        return f"{v[:4]}-{v[4:6]}-{v[6:]}"
    m = re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", version or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""


def updated_from_query(f):
    """ODPTセンターの版を日付で選ぶフィード（query.date=YYYYMMDD）は、その日付をカタログ上の版の日付として使う。"""
    d = str(((f.get("query") or {}) if isinstance(f, dict) else {}).get("date", ""))
    return f"{d[:4]}-{d[4:6]}-{d[6:]}" if len(d) == 8 and d.isdigit() else ""


def build_region(reg, paths, meta_idx, today, whatif_top=0):
    bbox = reg["bbox"]
    feed_defs = loaded_feed_defs(reg, paths)
    feed_keys = [fetch.feed_key(f) for f in feed_defs]
    feeds = [load_feed(paths["feed"][k], bbox, today) for k in feed_keys]
    net = Network(feeds, feed_keys)

    # 人口メッシュ（診断対象は停留所から DIAG_RADIUS_M 以内）
    pop = {}
    for code in fetch.primary_mesh_codes(bbox):
        for c, v in sources.read_mesh_population(paths["mesh"][code]).items():
            pop[c] = v
    node_grid = access.Grid([(la, lo) for la, lo, _ in net.nodes])
    lon0, lat0, lon1, lat1 = bbox
    cells = []
    for code, (p, p65) in pop.items():
        if p <= 0:
            continue
        a, b, c, d = sources.mesh_bounds(code)
        lat, lon = (a + c) / 2, (b + d) / 2
        if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
            continue
        if not node_grid.within(lat, lon, DIAG_RADIUS_M):
            continue
        cells.append((code, lat, lon, p, p65))
    cells.sort()

    # 施設
    pref = reg["pref"]
    hospitals = sources.read_hospitals(paths["p04"][pref], bbox)
    schools = sources.read_schools(paths["p29"][pref], bbox)
    fac = {"hospital": [(h[0], h[1]) for h in hospitals], "school": [(s[0], s[1]) for s in schools]}
    dg = access.Diagnoser(net, cells, fac)
    order = dg.order
    base_levels = dg.levels()
    levels = {c[0]: base_levels[k] for k, c in enumerate(cells)}
    walk = {c[0]: dg.walk_string(k) for k, c in enumerate(cells)}

    # 鉄道（GTFS未収録）: 駅から徒歩圏のメッシュに印を付ける（評価はしない）
    stations = rail_stations(reg, paths)
    rail_m = access.RAIL_WALK_MIN * 60 / access.walk_seconds(1.0)
    rail_flag = {}
    if stations:
        sgrid = access.Grid([(s_[0], s_[1]) for s_ in stations])
        for code, lat, lon, _p, _p65 in cells:
            if sgrid.within(lat, lon, rail_m):
                rail_flag[code] = 1

    # ノード統計
    stats = {dtp: net.node_stats(dtp) for dtp in DAYTYPES}
    used_routes = [set(), set()]
    nodes_out = []
    for i, (lat, lon, name) in enumerate(net.nodes):
        row = [r5(lon), r5(lat), name]
        rs = set()
        for dtp in DAYTYPES:
            cnt, first, last, routes = stats[dtp]
            row.append(cnt[i] + [-1 if first[i] is None else first[i] // 60, -1 if last[i] is None else last[i] // 60])
            rs |= routes[i]
        row.append(sorted(rs))
        nodes_out.append(row)

    # 路線: GTFS の route_id を (事業者, 路線名, 副名) でまとめた単位で出力する（「路線を止めたら？」の単位もこれ）
    feed_orgs = [feed_meta(f, k, meta_idx).get("organization_name", k[0]) for f, k in zip(feed_defs, feed_keys)]
    group_of, members, gkeys = group_routes(net, feed_orgs)
    trips_per_route = {dtp: {} for dtp in DAYTYPES}
    raw_patterns = {}
    for dtp in DAYTYPES:
        for ridx, seq, direction in net.trips[dtp]:
            trips_per_route[dtp][ridx] = trips_per_route[dtp].get(ridx, 0) + 1
            key = (ridx, direction)
            nodes_seq = [n for n, _, _ in seq]
            if key not in raw_patterns or len(nodes_seq) > len(raw_patterns[key]):
                raw_patterns[key] = nodes_seq
    group_pats = {}
    for (ridx, _d), nodes_seq in raw_patterns.items():
        group_pats.setdefault(group_of[ridx], []).append(nodes_seq)
    routes_out = []
    for g, (org, name, sub) in enumerate(gkeys):
        routes_out.append([
            name, sub, org,
            sum(trips_per_route["wd"].get(r, 0) for r in members[g]),
            sum(trips_per_route["hol"].get(r, 0) for r in members[g]),
            net.routes[members[g][0]][0],
        ])
    patterns_out = [[g, p] for g in sorted(group_pats) for p in prune_patterns(group_pats[g])]
    for row in nodes_out:   # ノードを通る路線: route_id の集合 -> まとめた路線の集合
        row[-1] = sorted({group_of[r] for r in row[-1]})

    feeds_out = []
    for fi, (f, k, fd) in enumerate(zip(feed_defs, feed_keys, feeds)):
        fm = feed_meta(f, k, meta_idx)
        is_odpt = isinstance(f, dict)
        feeds_out.append({
            "org": fm.get("organization_name", k[0]),
            "name": fm.get("feed_name", k[1]),
            "license": fm.get("feed_license", ""),
            "license_url": fm.get("feed_license_url", ""),
            "updated": fm.get("last_updated_at", "") or updated_from_version(fd.get("version")) or updated_from_query(f),
            "valid": [fmt_date(fd["start"]), fmt_date(fd["end"])],
            "ref": {d: fmt_date(fd["ref"][d]) for d in DAYTYPES},
            "url": fm.get("page_url") if is_odpt else f"https://www.gtfs-data.jp/search/organization/{k[0]}",
            "id": f"{k[0]}/{k[1]}",
            "source": "odpt" if is_odpt else "gtfs-data",
            "credit": fm.get("credit", ""),
            "modes": [mode_label(t) for t in fd.get("modes", [])],
            "expired": bool(fd.get("expired")),   # 作成日時点で有効期間が終わっている
            "ends_before_public_end": bool(fd["end"] and fd["end"] < PUBLIC_END),
        })

    cells_out = [[c, p, p65, levels[c], walk[c], rail_flag.get(c, 0)] for c, _la, _lo, p, p65 in cells]
    whatif = None
    if whatif_top:
        whatif = build_whatif(net, dg, base_levels, routes_out, whatif_top, members)
    lons = [n[0] for n in nodes_out]
    lats = [n[1] for n in nodes_out]
    out = {
        "id": reg["id"],
        "name": reg["name"],
        "reason": reg["reason"],
        "bbox": bbox,
        "center": [r5(sum(lons) / len(lons)), r5(sum(lats) / len(lats))],
        "facility_order": order,
        "facility_labels": {k: FACILITY_LABELS[k] for k in order},
        "params": {
            "thresholds": list(access.THRESHOLDS),
            "start_hours": access.START_HOURS,
            "walk_in_m": access.MAX_WALK_IN_M,
            "walk_out_m": access.MAX_WALK_OUT_M,
            "rail_walk_min": access.RAIL_WALK_MIN, "rail_walk_m": round(rail_m),
            "transfer_s": access.TRANSFER_S,
            "diag_radius_m": DIAG_RADIUS_M,
            "walk_m_per_min": 80, "detour": access.DETOUR,
        },
        "built": fmt_date(today),
        "public_until": fmt_date(PUBLIC_END),
        "coverage": {
            "feeds": len(feeds_out),
            "sources": sorted({"公共交通オープンデータセンター" if f["source"] == "odpt" else "GTFSデータリポジトリ" for f in feeds_out}),
            "modes": sorted({m for f in feeds_out for m in f["modes"]}),
            "rail_checked": stations is not None,
        },
        "rail": [[r5(s_[1]), r5(s_[0]), s_[2], s_[3]] for s_ in (stations or [])],
        "feeds": feeds_out,
        "nodes": nodes_out,
        "routes": routes_out,
        "patterns": patterns_out,
        "facilities": {
            "hospital": [[r5(h[1]), r5(h[0]), h[2]] for h in hospitals],
            "school": [[r5(s[1]), r5(s[0]), s[2], s[3]] for s in schools],
        },
        "cells": cells_out,
    }
    if whatif is not None:
        out["_whatif"] = whatif   # main() が別ファイルに書き出して取り除く
    return out


def build_whatif(net, dg, base_levels, routes_out, top_n, members=None):
    """便数の多い路線 top_n について「その路線が無かったら」の水準を再計算し、変化したメッシュだけ返す。

    routes_out の [3],[4] は平日・休日の便数。members[路線index] はその路線にまとめた GTFS route の index（無ければ路線=route）。戻り値 {"top_n", "routes": {路線index: [[セル番号, 水準文字列], ...]}}
    """
    ranked = sorted(range(len(routes_out)), key=lambda r: -(routes_out[r][3] + routes_out[r][4]))
    result = {}
    for ridx in ranked[:top_n]:
        if routes_out[ridx][3] + routes_out[ridx][4] == 0:
            continue
        lv = dg.levels(frozenset(members[ridx] if members else [ridx]))
        diff = [[k, lv[k]] for k in range(len(lv)) if lv[k] != base_levels[k]]
        if diff:
            result[str(ridx)] = diff
    return {"top_n": top_n, "routes": result}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--region")
    ap.add_argument("--whatif-top", type=int, default=WHATIF_TOP, help="路線除外の再計算を行う路線数（0で無効）")
    ap.add_argument("--reindex", action="store_true", help="地域のビルドはせず、生成済み地域ファイルから index.json だけ作り直す")
    args = ap.parse_args(argv)
    today = dt.date.fromisoformat(args.today)
    cfg = json.loads((ROOT / "regions.json").read_text(encoding="utf-8"))
    regions = [r for r in cfg["regions"] if not args.region or r["id"] == args.region]
    paths = {} if args.reindex else fetch.fetch_all(regions, ROOT / "cache")
    meta_idx = {} if args.reindex else feed_meta_index(paths["feeds_json"])
    out_dir = ROOT / "web" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for reg in regions:
        if args.reindex:   # 生成済みの地域ファイルから index.json だけを作り直す（地域を別々に並列ビルドしたあと用）
            data = json.loads((out_dir / f"{reg['id']}.json").read_text(encoding="utf-8"))
            size = (out_dir / f"{reg['id']}.json").stat().st_size
        else:
            data = build_region(reg, paths, meta_idx, today, args.whatif_top)
            whatif = data.pop("_whatif", None)
            if whatif is not None:
                wtext = json.dumps(whatif, ensure_ascii=False, separators=(",", ":"))
                (out_dir / f"whatif_{reg['id']}.json").write_text(wtext, encoding="utf-8")
                print("  whatif routes", len(whatif["routes"]), "bytes", len(wtext.encode("utf-8")))
            text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            (out_dir / f"{reg['id']}.json").write_text(text, encoding="utf-8")
            size = len(text.encode("utf-8"))
        tot = sum(c[1] for c in data["cells"])
        index.append({"id": reg["id"], "name": reg["name"], "center": data["center"], "bbox": reg["bbox"],
                      "population": tot, "operators": sorted({f["org"] for f in data["feeds"]}),
                      "built": data["built"], "size_bytes": size})
        print(reg["id"], "nodes", len(data["nodes"]), "routes", len(data["routes"]), "cells", len(data["cells"]),
              "pop", tot, "bytes", size)
    if not args.region:
        (out_dir / "index.json").write_text(json.dumps({"regions": index, "built": args.today},
                                                       ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
