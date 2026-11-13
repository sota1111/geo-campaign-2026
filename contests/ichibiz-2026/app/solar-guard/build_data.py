"""太陽光発電所の金属盗対策アプリ（茨城県）: 公開用の集計データ web/data/ を作る。

usage:
  python3 fetch_raw.py      # 原データを GET で取得（認定情報・e-Stat 小地域境界・e-Stat 1km メッシュ人口）
  python3 build_data.py     # raw/ だけから web/data/ を作る（ネットワーク不要・同じ入力なら同じ出力）

入力（すべて raw/）:
  ibaraki.xlsx            資源エネルギー庁 再エネ電子申請サイト「事業計画認定情報 公表用ウェブサイト」茨城県ファイル（2026年10月31日時点）
  r2ka08.dbf              e-Stat 国勢調査 2020 小地域（町丁・字等）境界 茨城県の属性表（町字名・代表点・人口・面積）
  estat_mesh/*.txt        e-Stat 国勢調査 2020 地域メッシュ統計 人口及び世帯（基準地域メッシュ＝約1km）

位置: 町字名を e-Stat 小地域の名称と突き合わせて代表点を得る（地理院の住所検索 API は使わない。外部への問い合わせなし）。
公開する集計: 約5km メッシュ（5倍地域メッシュ）と市町村。設備が K_MIN 件未満のメッシュ・市町村は件数・容量を出力しない。
出力に入れない項目: 事業者名・代表者名・事業者住所・電話番号・設備ID・個別設備の位置（読み込み後に集計して捨てる）。
"""
import collections
import json
import re
import struct
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import xlsx_min  # noqa: E402

RAW = HERE / "raw"
OUT = HERE / "web" / "data"
CELL = 5                      # 公開する集計メッシュの一辺（1kmメッシュ×5＝5倍地域メッシュ。約5km、東西約5.6km×南北約4.6km）
K_MIN = 3                     # これ未満の設備数のメッシュ・市町村は隠す（根拠は README「秘匿のしきい値」）
SMALL_KW = 50                 # 低圧（JPEA・REASP の区分: 10〜50kW未満）
AS_OF = "2026-10-31"
PREF = "茨城県"
BBOX = (35.6, 37.1, 139.5, 141.1)  # 人口グリッドを残す範囲（茨城県とその周辺）

KN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("ヶ", "ケ").replace("ヵ", "ケ").replace("ｹ", "ケ").replace("大字", "").replace("　", "").replace(" ", "")


def kanji_num(k):
    if k == "十":
        return 10
    if k.startswith("十"):
        return 10 + KN[k[1]]
    if len(k) == 2 and k[1] == "十":
        return KN[k[0]] * 10
    if len(k) == 3 and k[1] == "十":
        return KN[k[0]] * 10 + KN[k[2]]
    return KN[k[0]]


def split_chome(name):
    """'赤塚二丁目' → ('赤塚', 2)。丁目が無ければ (name, None)"""
    m = re.match(r"^(.*?)([一二三四五六七八九十]+)丁目$", name)
    return (m.group(1), kanji_num(m.group(2))) if m else (name, None)


def read_dbf(path):
    d = Path(path).read_bytes()
    n, hl, rl = struct.unpack("<IHH", d[4:12])
    fields, o, off = [], 32, 1
    while d[o] != 13:
        fields.append((d[o:o + 11].split(b"\0")[0].decode(), off, d[o + 16]))
        off += d[o + 16]
        o += 32
    return [{nm: d[hl + rl * i + a:hl + rl * i + a + ln].decode("cp932").strip() for nm, a, ln in fields} for i in range(n)]


def to_cell(lat, lon):
    """基準地域メッシュ（約1km）の格子番号。lat = iy/120, lon = 100 + ix/80（南西角）。"""
    return int((lon - 100) * 80 + 1e-9), int(lat * 120 + 1e-9)


def cell_code(ix, iy):
    """JIS X 0410 の基準地域メッシュコード（8桁）"""
    p, rem = divmod(iy, 80)
    q, r = divmod(rem, 10)
    u, rem2 = divmod(ix, 80)
    v, w = divmod(rem2, 10)
    return f"{p:02d}{u:02d}{q}{v}{r}{w}"


def code_to_cell(code):
    p, u, q, v, r, w = int(code[0:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7])
    return u * 80 + v * 10 + w, p * 80 + q * 10 + r


def load_areas():
    """e-Stat 小地域: 市町村 → 町字名（丁目を除いた基本名）→ [(丁目, lon, lat, 人口, 面積m2)]。市町村ごとの人口・面積も返す。"""
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    muni_pop, muni_area = collections.Counter(), collections.Counter()
    for r in read_dbf(RAW / "r2ka08.dbf"):
        if r["HCODE"] != "8101" or not r["S_NAME"]:
            continue  # 8154 は水面など（人が住む区域ではない）
        base, c = split_chome(norm(r["S_NAME"]))
        pop, area = int(r["JINKO"] or 0), float(r["AREA"] or 0)
        by[r["CITY_NAME"]][base].append((c, float(r["X_CODE"]), float(r["Y_CODE"]), pop, area))
        muni_pop[r["CITY_NAME"]] += pop
        muni_area[r["CITY_NAME"]] += area
    return by, muni_pop, muni_area


ADDR_FIELDS = {"kind": "発電設備区分", "kw": "発電出力", "addr": "発電設備の所在地", "pv": "太陽電池の合計出力", "start": "運転開始報告年月"}


def parse_address(addr, cities):
    """'茨城県東茨城郡茨城町大字長岡字剣尺４０７０－４６６' → ('茨城町', '長岡字剣尺')。丁目や番地の数字より前を返す。"""
    a = norm(addr).replace(PREF, "", 1)
    a = re.sub(r"^[^市町村]*郡", "", a)
    city = next((c for c in cities if a.startswith(norm(c))), None)
    if not city:
        return None, ""
    rest = a[len(norm(city)):]
    rest = re.split(r"[0-9\-－ー‐・（(]", rest)[0]
    return city, rest


def locate(rest, towns):
    """町字の代表点を返す: (lon, lat, 面積m2, 精度) か None。
    精度0: 町字名（丁目を除く）が小地域名と一致。 精度1: 一致する小地域がなく、大字名で始まる小地域の代表点の平均（大字の中心の目安）。"""
    r = rest.replace("字", "")
    best = None
    for base in towns:
        if base and r.startswith(base) and (best is None or len(base) > len(best)):
            best = base
    if best:
        e = towns[best]
        return (sum(x[1] for x in e) / len(e), sum(x[2] for x in e) / len(e), sum(x[4] for x in e), 0)
    head = rest.split("字")[0] if not rest.startswith("字") else rest[1:].split("字")[0]
    if len(head) >= 2:
        es = [x for b, e in towns.items() if b.startswith(head) for x in e]
        if es:
            return (sum(x[1] for x in es) / len(es), sum(x[2] for x in es) / len(es), sum(x[4] for x in es), 1)
    return None


def num(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def load_pops():
    """1km メッシュの人口: {(ix, iy): 人口}。e-Stat は人数が少ないメッシュを '*' にして近隣へ合算する（合算先の値に含まれる）ので '*' は 0 とする。"""
    pops = {}
    for p in sorted((RAW / "estat_mesh").glob("tblT001100S*.txt")):
        lines = p.read_text(encoding="cp932").splitlines()
        for ln in lines[2:]:
            f = ln.split(",")
            if len(f) < 5 or not f[0].isdigit() or len(f[0]) != 8:
                continue
            v = int(f[4]) if f[4].isdigit() else 0
            ix, iy = code_to_cell(f[0])
            if BBOX[0] <= iy / 120 <= BBOX[1] and BBOX[2] <= 100 + ix / 80 <= BBOX[3]:
                pops[(ix, iy)] = v
    return pops


def cell_pop(pops, k):
    """集計メッシュ（CELL×CELL の1kmメッシュ）の人口。pops に無いメッシュは 0（人口0・秘匿のどちらも）。"""
    return sum(pops.get((k[0] * CELL + dx, k[1] * CELL + dy), 0) for dx in range(CELL) for dy in range(CELL))


def main():
    by, muni_pop, muni_area = load_areas()
    cities = sorted(by, key=len, reverse=True)
    rows = xlsx_min.read_sheet(RAW / "ibaraki.xlsx", 1)
    hi = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "設備ID")
    hdr = rows[hi]

    def ci(prefix):
        return next(i for i, h in enumerate(hdr) if h.startswith(prefix))

    c = {k: ci(v) for k, v in ADDR_FIELDS.items()}
    data = [r + [""] * (len(hdr) - len(r)) for r in rows[hi + 1:] if len(r) > c["kind"] and r[c["kind"]] == "太陽光"]
    stat = {"rows": len(data), "not_started": 0, "no_muni": 0, "no_kw": 0, "placed_exact": 0, "placed_ohaza": 0, "unplaced": 0}
    areas = []
    cells = collections.defaultdict(lambda: [0, 0.0, 0])  # (ix,iy) → [件数, 容量kW, うち50kW未満の件数]
    munis = collections.defaultdict(lambda: {"n": 0, "kw": 0.0, "small": 0, "placed": 0})
    for r in data:
        if not r[c["start"]] or r[c["start"]] == "-":
            stat["not_started"] += 1  # 運転開始前
            continue
        kw = num(r[c["kw"]]) or num(r[c["pv"]])
        if not kw:
            stat["no_kw"] += 1
            continue
        city, rest = parse_address(r[c["addr"]], cities)
        if not city:
            stat["no_muni"] += 1
            continue
        m = munis[city]
        m["n"] += 1
        m["kw"] += kw
        m["small"] += kw < SMALL_KW
        loc = locate(rest, by[city])
        if not loc:
            stat["unplaced"] += 1
            continue
        stat["placed_exact" if loc[3] == 0 else "placed_ohaza"] += 1
        areas.append(loc[2] / 1e6)
        m["placed"] += 1
        ix, iy = to_cell(loc[1], loc[0])
        k = (ix // CELL, iy // CELL)
        cl = cells[k]
        cl[0] += 1
        cl[1] += kw
        cl[2] += kw < SMALL_KW
    areas.sort()
    stat["town_area_km2_median"] = round(areas[len(areas) // 2], 1)
    stat["town_area_km2_p90"] = round(areas[int(len(areas) * 0.9)], 1)
    stat["counted"] = sum(m["n"] for m in munis.values())
    stat["placed"] = stat["placed_exact"] + stat["placed_ohaza"]

    visible = sorted((k, v) for k, v in cells.items() if v[0] >= K_MIN)
    stat["cells_all"] = len(cells)
    stat["cells_visible"] = len(visible)
    stat["cells_hidden"] = len(cells) - len(visible)
    stat["plants_in_hidden_cells"] = sum(v[0] for v in cells.values() if v[0] < K_MIN)

    pops = load_pops()
    pop_rows = sorted([ix, iy, p] for (ix, iy), p in pops.items() if p > 0)

    mrows = []
    for name in sorted(munis):
        m = munis[name]
        ok = m["n"] >= K_MIN
        mrows.append({"name": name, "n": m["n"] if ok else None, "kw": round(m["kw"], 1) if ok else None, "small": m["small"] if ok else None,
                      "pop": muni_pop[name], "area_km2": round(muni_area[name] / 1e6, 1)})

    meta = {
        "prefecture": PREF, "as_of": AS_OF, "k_min": K_MIN, "small_kw": SMALL_KW,
        "plants_source": "資源エネルギー庁 再生可能エネルギー電子申請サイト 事業計画認定情報 公表用ウェブサイト（茨城県ファイル）",
        "plants_url": "https://www.fit-portal.go.jp/PublicInfo", "terms_url": "https://www.fit-portal.go.jp/Terms",
        "retrieved": "2026-11-13",
        "boundary_source": "総務省統計局 e-Stat 国勢調査 2020 小地域（町丁・字等）境界（世界測地系緯度経度）の属性表（町字名・代表点・人口・面積）",
        "mesh_source": "総務省統計局 e-Stat 国勢調査 2020 地域メッシュ統計 人口及び世帯（基準地域メッシュ＝約1km、第1次地域区画 5339 5340 5439 5440 5539 5540）",
        "estat_terms": "https://www.e-stat.go.jp/terms-of-use",
        "stats": stat, "real_data": True,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda name, obj: (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    dump("cells.json", {"meta": meta, "cell": CELL, "cols": ["cx", "cy", "n", "kw", "small", "pop"],
                         "rows": [[k[0], k[1], v[0], round(v[1], 1), v[2], cell_pop(pops, k)] for k, v in visible]})
    dump("pops.json", {"meta": {"source": meta["mesh_source"], "note": "人口0または秘匿('*')のメッシュは含めない。秘匿は近隣メッシュに合算されている（e-Stat）"}, "cols": ["ix", "iy", "pop"], "rows": pop_rows})
    dump("munis.json", {"k_min": K_MIN, "rows": mrows})
    print("stats:", json.dumps(stat, ensure_ascii=False))
    print("cells visible:", len(visible), "munis:", len(mrows), "pop cells:", len(pop_rows))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
