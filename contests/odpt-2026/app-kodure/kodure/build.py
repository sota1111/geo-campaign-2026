"""前処理: 取得済みデータ → web/data/*.json（子連れお出かけ診断）。

python3 build.py [--today YYYY-MM-DD] [--workers N] [--limit-dests N]
"""
import argparse
import datetime as dt
import json
import multiprocessing as mp
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT.parent / "app"          # 既存アプリ（lifemap を import して再利用する。変更しない）
if str(APP) not in sys.path:
    sys.path.append(str(APP))   # 末尾に足す（app/tests や app/build.py が、こちらの tests や build.py より先に見つからないように）

from lifemap import access, fetch, sources as lm_sources            # noqa: E402
from lifemap import build as lm_build                               # noqa: E402
from lifemap.gtfs import load_feed                                  # noqa: E402
from lifemap.network import Network                                 # noqa: E402

from . import dests as dests_mod                                    # noqa: E402
from . import router as rt                                          # noqa: E402
from . import sources                                               # noqa: E402

P13_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P13/P13-11/P13-11_{pref}_GML.zip"
P27_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P27/P27-13/P27-13_{pref}.zip"
OSAKA = {"id": "osaka", "name": "大阪市とその周辺", "pref": "27", "bbox": [135.35, 34.55, 135.65, 34.80]}
DIAG_RADIUS_M = 2000          # 診断対象 = 収録停留所からこの距離以内の人口メッシュ
RAIL_WALK_MIN = 15            # 鉄道駅まで徒歩この分数以内のメッシュを「鉄道駅が近い（未評価）」とする
PUBLIC_END = lm_build.PUBLIC_END
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"   # 符号 1..18 -> A..R


# ---------- 出力の符号化 ----------
def rle_row(row):
    """符号(0..18)の bytearray -> 文字列。0 の連続は10進数の長さ、符号は英大文字（1=A）。末尾の0は省く。
    例: [0,0,0,2,0,1] -> '3B1A'"""
    out = []
    z = 0
    for v in row:
        if v == 0:
            z += 1
        else:
            if z:
                out.append(str(z))
                z = 0
            out.append(LETTERS[v - 1])
    return "".join(out)


def rle_decode(s, n):
    row = bytearray(n)
    i = j = 0
    while j < len(s):
        if s[j].isdigit():
            k = j
            while k < len(s) and s[k].isdigit():
                k += 1
            i += int(s[j:k])
            j = k
        else:
            row[i] = LETTERS.index(s[j]) + 1
            i += 1
            j += 1
    return row


# ---------- 計算 ----------
G = {}   # 子プロセスと共有する読み取り専用の作業データ（fork で引き継ぐ）


def _out_task(args):
    """行き: 家（メッシュ）→行き先。cells の chunk ごとに前方探索。戻り値 [(cap, hour, cell番号, [層ごとの[(dest番号,符号)]])]"""
    cap, hour, idxs = args
    t0 = hour * 3600
    res = []
    for ci in idxs:
        lat, lon = G["cell_pts"][ci]
        src = rt.source_map((lat, lon), G["node_grid"], cap, t0)
        labels = G["router"].scan(src, t0) if src else (None, None, None)
        walk = G["walk_cd"][cap].get(ci, {})
        if src:
            layers = rt.collect(labels, G["inv_dest"][cap], t0, len(G["dest_pts"]), walk)
        else:
            layers = rt.collect([[rt.INF] * G["router"].n] * 3, {}, t0, len(G["dest_pts"]), walk)
        res.append((cap, hour, ci, [[(d, c) for d, c in enumerate(codes) if c] for codes in layers]))
    return res


def _ret_task(args):
    """帰り: 行き先→家。dests の chunk ごとに前方探索。戻り値 [(cap, hour, dest番号, [層ごとの[(cell番号,符号)]])]"""
    cap, hour, idxs = args
    t0 = hour * 3600
    res = []
    for di in idxs:
        lat, lon = G["dest_pts"][di]
        src = rt.source_map((lat, lon), G["node_grid"], cap, t0)
        walk = G["walk_dc"][cap].get(di, {})
        if src:
            labels = G["router"].scan(src, t0)
            layers = rt.collect(labels, G["inv_cell"][cap], t0, len(G["cell_pts"]), walk)
        else:
            layers = rt.collect([[rt.INF] * G["router"].n] * 3, {}, t0, len(G["cell_pts"]), walk)
        res.append((cap, hour, di, [[(c, k) for c, k in enumerate(codes) if k] for codes in layers]))
    return res


def chunks(n, size):
    return [list(range(i, min(n, i + size))) for i in range(0, n, size)]


def compute_matrices(network, cell_pts, dest_pts, caps=rt.CAPS_M, out_hours=rt.OUT_HOURS, ret_hours=rt.RET_HOURS,
                     workers=1, progress=None):
    """行き・帰りの所要時間の行列を計算する。

    戻り値 {(dir, hour, cap, layer): [行き先ごとの bytearray(len(cell_pts))]}（dir は 'o'=行き, 'r'=帰り、符号は5分刻み）。
    """
    router = rt.Router(network)
    node_grid = access.Grid([(la, lo) for la, lo, _ in network.nodes])
    nc, nd = len(cell_pts), len(dest_pts)
    G.clear()
    G.update(router=router, node_grid=node_grid, cell_pts=cell_pts, dest_pts=dest_pts,
             inv_dest={}, inv_cell={}, walk_cd={}, walk_dc={})
    for cap in caps:
        G["inv_dest"][cap] = rt.invert(dest_pts, node_grid, cap)
        G["inv_cell"][cap] = rt.invert(cell_pts, node_grid, cap)
        cd = rt.walk_pairs(cell_pts, dest_pts, cap, access.Grid)
        dc = {}
        for ci, near in cd.items():
            for di, sec in near.items():
                dc.setdefault(di, {})[ci] = sec
        G["walk_cd"][cap], G["walk_dc"][cap] = cd, dc
    mats = {(d, h, cap, ly): [bytearray(nc) for _ in range(nd)]
            for d, hs in (("o", out_hours), ("r", ret_hours)) for h in hs for cap in caps for ly in rt.LAYERS}
    tasks = []
    for cap in caps:
        for h in out_hours:
            tasks += [(_out_task, (cap, h, ix)) for ix in chunks(nc, 40)]
        for h in ret_hours:
            tasks += [(_ret_task, (cap, h, ix)) for ix in chunks(nd, 12)]
    if workers > 1:
        ctx = mp.get_context("fork")
        with ctx.Pool(workers) as pool:
            results = pool.imap_unordered(_run, tasks, chunksize=1)
            _merge(results, mats, len(tasks), progress)
    else:
        _merge((_run(t) for t in tasks), mats, len(tasks), progress)
    return mats


def _run(task):
    fn, args = task
    return fn is _out_task, fn(args)


def _merge(results, mats, total, progress):
    done = 0
    for is_out, res in results:
        for cap, hour, i, layers in res:
            for ly, pairs in zip(rt.LAYERS, layers):
                if is_out:
                    for d, c in pairs:
                        mats[("o", hour, cap, ly)][d][i] = c
                else:
                    row = mats[("r", hour, cap, ly)][i]
                    for c, k in pairs:
                        row[c] = k
        done += 1
        if progress and done % 20 == 0:
            progress(done, total)


# ---------- 入力の組み立て ----------
def fetch_inputs(reg, cache: Path):
    paths = {"feed": {}, "skipped": [], "mesh": {}, "rail": None}
    for f in reg["feeds"]:
        got = fetch.fetch_feed(f, cache)
        if got is None:
            paths["skipped"].append(fetch.feed_key(f))
        else:
            paths["feed"][fetch.feed_key(f)] = got
    paths["rail"] = fetch.cached(cache / "ksj" / "N02-22.zip", fetch.N02_URL)
    for code in fetch.primary_mesh_codes(reg["bbox"]):
        paths["mesh"][code] = fetch.cached(cache / "mesh" / f"T001102_{code}.zip", fetch.MESH_URL.format(code=code))
    return paths


def fetch_dest_files(pref, cache: Path):
    p13 = fetch.cached(cache / "ksj" / f"P13-11_{pref}_GML.zip", P13_URL.format(pref=pref))
    p27 = fetch.cached(cache / "ksj" / f"P27-13_{pref}.zip", P27_URL.format(pref=pref))
    return p13, p27


def build_cells(reg, paths, network):
    """診断対象の人口メッシュ [(code, lat, lon, 人口, 0〜14歳)]（収録停留所から DIAG_RADIUS_M 以内）。"""
    bbox = reg["bbox"]
    pop = {}
    for code in fetch.primary_mesh_codes(bbox):
        pop.update(sources.read_mesh_population_0_14(paths["mesh"][code]))
    node_grid = access.Grid([(la, lo) for la, lo, _ in network.nodes])
    lon0, lat0, lon1, lat1 = bbox
    cells = []
    for code, (p, p14) in pop.items():
        if p <= 0:
            continue
        a, b, c, d = lm_sources.mesh_bounds(code)
        lat, lon = (a + c) / 2, (b + d) / 2
        if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
            continue
        if not node_grid.within(lat, lon, DIAG_RADIUS_M):
            continue
        cells.append((code, lat, lon, p, p14))
    cells.sort()
    return cells


def rail_flags(reg, paths, cells):
    """GTFS未収録の鉄道の駅（N02）から徒歩 RAIL_WALK_MIN 分圏（子連れの徒歩速度）のメッシュ -> 1。駅の一覧も返す。"""
    stations = lm_build.rail_stations(reg, paths) or []
    rail_m = RAIL_WALK_MIN * 60 / rt.walk_seconds(1.0)
    flags = [0] * len(cells)
    if stations:
        g = access.Grid([(s[0], s[1]) for s in stations])
        for i, (_c, lat, lon, _p, _q) in enumerate(cells):
            if g.within(lat, lon, rail_m):
                flags[i] = 1
    return flags, stations, rail_m


def r5(x):
    return round(x, 5)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=dt.date.today().isoformat(), help="診断の基準日の起点（これ以降の最初の日曜を休日の基準日にする）")
    ap.add_argument("--workers", type=int, default=max(1, (mp.cpu_count() or 2) - 2))
    ap.add_argument("--limit-dests", type=int, default=0, help="試験用: 行き先の数を減らす")
    ap.add_argument("--cache", default=str(ROOT / "cache"))
    args = ap.parse_args(argv)
    today = dt.date.fromisoformat(args.today)
    cache = Path(args.cache)
    reg = next(r for r in json.loads((APP / "regions.json").read_text(encoding="utf-8"))["regions"] if r["id"] == "tokyo")
    out_dir = ROOT / "web" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    paths = fetch_inputs(reg, cache)
    meta_idx = lm_build.feed_meta_index(fetch.cached(cache / "feeds.json", fetch.FEEDS_URL))
    feed_defs = lm_build.loaded_feed_defs(reg, paths)
    feed_keys = [fetch.feed_key(f) for f in feed_defs]
    feeds = [load_feed(paths["feed"][k], reg["bbox"], today) for k in feed_keys]
    net = Network(feeds, feed_keys)
    print("nodes", net.n, "hol trips", len(net.trips["hol"]), "skipped feeds", paths["skipped"])

    cells = build_cells(reg, paths, net)
    p13, p27 = fetch_dest_files(reg["pref"], cache)
    dests = dests_mod.read_destinations(p13, p27, reg["bbox"])
    if args.limit_dests:
        dests = dests[:args.limit_dests]
    print("cells", len(cells), "dests", len(dests))
    flags, stations, rail_m = rail_flags(reg, paths, cells)

    mats = compute_matrices(net, [(c[1], c[2]) for c in cells], [(d[1], d[0]) for d in dests], workers=args.workers,
                            progress=lambda a, b: print(f"  {a}/{b}", flush=True))
    sizes = {}
    for (d, h, cap, ly), rows in mats.items():
        name = f"m_{d}{h}_c{cap}_t{ly}.json"
        text = json.dumps([rle_row(r) for r in rows], separators=(",", ":"))
        (out_dir / name).write_text(text, encoding="utf-8")
        sizes[name] = len(text.encode("utf-8"))

    feeds_out = []
    for f, k, fd in zip(feed_defs, feed_keys, feeds):
        fm = lm_build.feed_meta(f, k, meta_idx)
        feeds_out.append({
            "org": fm.get("organization_name", k[0]), "name": fm.get("feed_name", k[1]),
            "license": fm.get("feed_license", ""), "license_url": fm.get("feed_license_url", ""),
            "credit": fm.get("credit", ""), "url": fm.get("page_url", ""),
            "updated": fm.get("last_updated_at", "") or lm_build.updated_from_version(fd.get("version")) or lm_build.updated_from_query(f),
            "valid": [lm_build.fmt_date(fd["start"]), lm_build.fmt_date(fd["end"])],
            "ref_hol": lm_build.fmt_date(fd["ref"]["hol"]),
            "modes": [lm_build.mode_label(t) for t in fd.get("modes", [])],
            "expired": bool(fd.get("expired")),
            "ends_before_public_end": bool(fd["end"] and fd["end"] < PUBLIC_END),
        })
    lons = [c[2] for c in cells]
    lats = [c[1] for c in cells]
    meta = {
        "schema": 1,
        "built": today.isoformat(),
        "public_until": PUBLIC_END.isoformat(),
        "region": {"id": reg["id"], "name": "東京都区部", "bbox": reg["bbox"],
                   "center": [r5(sum(lons) / len(lons)), r5(sum(lats) / len(lats))]},
        "params": {
            "walk_m_per_min": rt.WALK_M_PER_MIN, "detour": rt.DETOUR, "transfer_s": rt.TRANSFER_S,
            "caps_m": list(rt.CAPS_M), "out_hours": list(rt.OUT_HOURS), "ret_hours": list(rt.RET_HOURS),
            "layers": list(rt.LAYERS), "max_min": rt.MAX_MIN, "quant_min": rt.QUANT_MIN,
            "rail_walk_min": RAIL_WALK_MIN, "rail_walk_m": round(rail_m), "diag_radius_m": DIAG_RADIUS_M,
            "park_min_m2": dests_mod.PARK_MIN_M2, "park_large_m2": dests_mod.PARK_LARGE_M2,
        },
        "kinds": [[k, lbl] for k, lbl in dests_mod.KINDS],
        "coverage": {"feeds": len(feeds_out), "modes": sorted({m for f in feeds_out for m in f["modes"]}),
                     "skipped_feeds": [list(k) for k in paths["skipped"]]},
        "feeds": feeds_out,
        "rail": [[r5(s[1]), r5(s[0]), s[2], s[3]] for s in stations],
        "cells": [[c[0], c[3], c[4], flags[i]] for i, c in enumerate(cells)],
        "dests": [[r5(d[0]), r5(d[1]), d[2], d[3], d[5], round(d[4] / 10000, 1)] for d in dests],
        "files": sizes,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 大阪: 時刻表のオープンデータが無いので位置だけ（時間は計算しない）
    op13, op27 = fetch_dest_files(OSAKA["pref"], cache)
    od = dests_mod.read_destinations(op13, op27, OSAKA["bbox"])
    osaka = {"id": OSAKA["id"], "name": OSAKA["name"], "bbox": OSAKA["bbox"],
             "center": [r5((OSAKA["bbox"][0] + OSAKA["bbox"][2]) / 2), r5((OSAKA["bbox"][1] + OSAKA["bbox"][3]) / 2)],
             "dests": [[r5(d[0]), r5(d[1]), d[2], d[3], d[5], round(d[4] / 10000, 1)] for d in od]}
    (out_dir / "osaka.json").write_text(json.dumps(osaka, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("osaka dests", len(od), "total bytes", sum(sizes.values()))


if __name__ == "__main__":
    main()
