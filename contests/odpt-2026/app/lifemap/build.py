"""前処理: 取得済みデータ → web/data/*.json。

python3 -m lifemap.build [--today YYYY-MM-DD] [--region ID] [--fetch]
"""
import argparse
import datetime as dt
import json
from pathlib import Path

from . import access, fetch, sources
from .gtfs import DAYTYPES, load_feed
from .network import Network

ROOT = Path(__file__).resolve().parent.parent
DIAG_RADIUS_M = 2000   # 診断対象 = 収録停留所からこの距離以内の人口メッシュ
FACILITY_LABELS = {"hospital": "病院", "school": "小・中学校"}


def fmt_date(d):
    return d.isoformat() if d else None


def feed_meta_index(feeds_json_path):
    body = json.loads(Path(feeds_json_path).read_text(encoding="utf-8"))["body"]
    return {(f["organization_id"], f["feed_id"]): f for f in body}


def r5(x):
    return round(x, 5)


def build_region(reg, paths, meta_idx, today, only_pattern_limit=2):
    bbox = reg["bbox"]
    feed_keys = [tuple(k) for k in reg["feeds"]]
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
    levels, walk, order = access.diagnose_cells(net, cells, fac)

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

    # 路線（名称・便数・代表系統）
    trips_per_route = {dtp: {} for dtp in DAYTYPES}
    patterns = {}
    for dtp in DAYTYPES:
        for ridx, seq, direction in net.trips[dtp]:
            trips_per_route[dtp][ridx] = trips_per_route[dtp].get(ridx, 0) + 1
            key = (ridx, direction)
            nodes_seq = [n for n, _, _ in seq]
            if key not in patterns or len(nodes_seq) > len(patterns[key]):
                patterns[key] = nodes_seq
    routes_out = []
    for ridx, (fi, rid, short, long_, color) in enumerate(net.routes):
        fm = meta_idx.get(feed_keys[fi], {})
        routes_out.append([
            short or long_ or rid, long_ if short else "", fm.get("organization_name", feed_keys[fi][0]),
            trips_per_route["wd"].get(ridx, 0), trips_per_route["hol"].get(ridx, 0), fi,
        ])
    patterns_out = [[ridx, nodes_seq] for (ridx, _d), nodes_seq in sorted(patterns.items())]
    # 便が無い路線を除外しないが、パターンの無い路線は routes のまま残す（一覧用）

    feeds_out = []
    for fi, (k, fd) in enumerate(zip(feed_keys, feeds)):
        fm = meta_idx.get(k, {})
        feeds_out.append({
            "org": fm.get("organization_name", k[0]),
            "name": fm.get("feed_name", k[1]),
            "license": fm.get("feed_license", ""),
            "license_url": fm.get("feed_license_url", ""),
            "updated": fm.get("last_updated_at", ""),
            "valid": [fmt_date(fd["start"]), fmt_date(fd["end"])],
            "ref": {d: fmt_date(fd["ref"][d]) for d in DAYTYPES},
            "url": f"https://www.gtfs-data.jp/search/organization/{k[0]}",
            "id": f"{k[0]}/{k[1]}",
        })

    cells_out = [[c, p, p65, levels[c], walk[c]] for c, _la, _lo, p, p65 in cells]
    lons = [n[0] for n in nodes_out]
    lats = [n[1] for n in nodes_out]
    return {
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
            "walk_only_m": access.WALK_ONLY_M,
            "transfer_s": access.TRANSFER_S,
            "diag_radius_m": DIAG_RADIUS_M,
            "walk_m_per_min": 80, "detour": access.DETOUR,
        },
        "built": fmt_date(today),
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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--region")
    ap.add_argument("--fetch", action="store_true", help="キャッシュが無ければ取得する")
    args = ap.parse_args(argv)
    today = dt.date.fromisoformat(args.today)
    cfg = json.loads((ROOT / "regions.json").read_text(encoding="utf-8"))
    regions = [r for r in cfg["regions"] if not args.region or r["id"] == args.region]
    paths = fetch.fetch_all(regions, ROOT / "cache")
    meta_idx = feed_meta_index(paths["feeds_json"])
    out_dir = ROOT / "web" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for reg in regions:
        data = build_region(reg, paths, meta_idx, today)
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        (out_dir / f"{reg['id']}.json").write_text(text, encoding="utf-8")
        tot = sum(c[1] for c in data["cells"])
        index.append({"id": reg["id"], "name": reg["name"], "center": data["center"], "bbox": reg["bbox"],
                      "population": tot, "operators": sorted({f["org"] for f in data["feeds"]}),
                      "built": data["built"], "size_bytes": len(text.encode("utf-8"))})
        print(reg["id"], "nodes", len(data["nodes"]), "routes", len(data["routes"]), "cells", len(data["cells"]),
              "pop", tot, "bytes", len(text.encode("utf-8")))
    if not args.region:
        (out_dir / "index.json").write_text(json.dumps({"regions": index, "built": args.today},
                                                       ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
