"""再エネ事業計画認定情報（京都府分）から、デモ用の web/data/ を作る。

usage:
  python3 build_data.py            # raw/kyoto.xlsx が無ければ公表サイトから取得し、住所を地理院APIで位置に直す
  python3 build_data.py --offline  # 取得・API呼び出しをせず、raw/ と cache/ だけで作る（再現確認用）

入力: 資源エネルギー庁 再生可能エネルギー電子申請サイト「事業計画認定情報 公表用ウェブサイト」の京都府ファイル
      https://www.fit-portal.go.jp/PublicInfo （2026年9月30日時点、2026-10-14公表）
      利用ルール https://www.fit-portal.go.jp/Terms （出典記載と加工の明記で商用利用可）
位置: 国土地理院 住所検索API（GET、キー不要）。結果は cache/geocode.json に保存し、再実行しても同じ結果にする。
出力に入れない項目: 事業者名・代表者名・事業者住所・電話番号・設備ID（個人や事業者を特定しない。地図は設備の所在地の町字まで）。
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xlsx_min  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "kyoto.xlsx"
CACHE = HERE / "cache" / "geocode.json"
OUT = HERE / "web" / "data"
FIT_PAGE = "https://www.fit-portal.go.jp/PublicInfo"
KYOTO_FILE = "https://www.fit-portal.go.jp/servlet/servlet.FileDownload?retURL=%2Fapex%2FPublicInfo&file=00PhA000001bAHZUA2"
GSI = "https://msearch.gsi.go.jp/address-search/AddressSearch?q="
BBOX = (34.6, 35.8, 134.7, 136.2)  # 京都府の外れ値を弾く目安（緯度の下限・上限、経度の下限・上限）

# 京都府「太陽光パネルの3R・適正処理について」（更新日2026年3月5日）の「4.京都府内の太陽光パネルのリサイクル業者」
# https://www.pref.kyoto.jp/sanpai/pvpanerutekiseisyori.html の記載をそのまま写した。
FACILITIES = [
    {"name": "近畿電電輸送株式会社", "address": "京都府八幡市岩田六ノ坪57番1", "geo_q": "京都府八幡市岩田六ノ坪57", "url": "https://www.kdy.co.jp/", "note": ""},
    {"name": "株式会社浜田", "address": "京都府八幡市下奈良小宮4番2", "geo_q": "京都府八幡市下奈良小宮4", "url": "https://www.kkhamada.com/", "note": "公表ページの所在地は「下奈良小宮4番2、7番」"},
    {"name": "株式会社京都環境保全公社", "address": "京都府京都市伏見区横大路千両松町126番地", "geo_q": "京都府京都市伏見区横大路千両松町126",
     "url": "https://www.kyoto-kankyo.net/work/sunlight-panel.html",
     "note": "同社ページ: 太陽光パネルの処理能力4.6t/日（24時間）、破砕分離。京都府北部にも搬入拠点があるとするが所在地は未確認のため、地図には出していない"},
]

FW = str.maketrans("０１２３４５６７８９", "0123456789")


def load_cache():
    return json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}


def save_cache(c):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(c, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")


def geocode(q, cache, offline, floor=0):
    """住所文字列 → [lon, lat, title] か None。
    タイトルがクエリで始まるものを採用する。floor を指定した場合は、クエリがタイトルで始まる（小字などを除いた大字までの）候補も、
    市区町村より長ければ採用する（最も長いもの）。"""
    if q in cache:
        return cache[q]
    if offline:
        return None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(GSI + urllib.parse.quote(q), timeout=20) as r:
                data = json.load(r)
            break
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        return None  # キャッシュしない（次回再試行）
    res = None
    qn = q.translate(FW)
    for f in data:
        title = f["properties"]["title"].translate(FW)
        lon, lat = f["geometry"]["coordinates"]
        if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]):
            continue
        if title.startswith(qn):
            res = [lon, lat, title]
            break
        if floor and qn.startswith(title) and len(title) > floor and (res is None or len(title) > len(res[2])):
            res = [lon, lat, title]
    cache[q] = res
    time.sleep(0.3)
    return res


MUNI_RE = re.compile(r"^京都府((?:[^郡市町村]+郡)?)(.+?[市町村])(.+?区)?")


def split_address(addr):
    """('京都府京都市南区吉祥院観音堂南町１－５５') → (muni='京都市南区', gun_muni_query_prefix, town)"""
    a = addr.replace("　", "").replace(" ", "")
    m = MUNI_RE.match(a)
    if not m:
        return None
    gun, city, ku = m.group(1), m.group(2), m.group(3) or ""
    if ku and not city.endswith("市"):
        ku = ""
    muni = city + ku
    rest = a[m.end():]
    rest = rest.replace("大字", "")
    rest = rest.split("小字")[0]
    rest = re.split(r"[0-9０-９]", rest)[0]
    rest = rest.lstrip("字").rstrip("字")
    return muni, "京都府" + gun + muni, rest


def ym(s):
    m = re.match(r"(\d{4})年(\d{1,2})月", s or "")
    return int(m.group(1)) * 100 + int(m.group(2)) if m else 0


def serial_ym(s):
    import datetime
    try:
        d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(s)))
    except (ValueError, TypeError):
        return 0
    return d.year * 100 + d.month


def num(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def main():
    offline = "--offline" in sys.argv
    if not RAW.exists():
        if offline:
            sys.exit("raw/kyoto.xlsx がありません（--offline では取得しません）")
        RAW.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(KYOTO_FILE, timeout=120) as r:
            RAW.write_bytes(r.read())
        print("downloaded", RAW, RAW.stat().st_size, "bytes")
    rows = xlsx_min.read_sheet(RAW, 1)
    hi = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "設備ID")
    hdr = rows[hi]

    def ci(prefix):
        return next(i for i, h in enumerate(hdr) if h.startswith(prefix))

    c_kind, c_kw, c_addr = ci("発電設備区分"), ci("発電出力"), ci("発電設備の所在地")
    c_pv, c_cert, c_start = ci("太陽電池の合計出力"), ci("新規認定日"), ci("運転開始報告年月")
    c_fit, c_state = ci("調達期間/交付期間終了年月"), ci("廃棄費用の積立状況")
    data = [r + [""] * (len(hdr) - len(r)) for r in rows[hi + 1:] if len(r) > c_kind and r[c_kind] == "太陽光"]
    print("太陽光の行:", len(data))

    cache = load_cache()
    if not offline:
        cache = {k: v for k, v in cache.items() if v}  # 引けなかった記録は、判定を改めたので取り直す
    munis, mi, out = [], {}, []
    stat = {"rows": len(data), "not_started": 0, "town": 0, "muni": 0, "unplaced": 0}
    todo = {}
    parsed = []
    for r in data:
        sp = split_address(r[c_addr])
        parsed.append(sp)
        if sp:
            if sp[2]:
                todo[sp[1] + sp[2]] = len(sp[1])
            todo[sp[1]] = 0
    floor_of = todo
    todo = sorted(t for t in floor_of if t not in cache)
    if todo and not offline:
        print("地理院APIで位置を取得:", len(todo), "件（約", int(len(todo) * 0.35 / 60) + 1, "分）")
    for i, q in enumerate(todo):
        if offline:
            break
        geocode(q, cache, False, floor_of[q])
        if i % 100 == 99:
            save_cache(cache)
            print(" ", i + 1, "/", len(todo), flush=True)
    if not offline:
        save_cache(cache)

    for r, sp in zip(data, parsed):
        if sp is None:
            stat["unplaced"] += 1
            continue
        muni, qm, town = sp
        g, prec = (geocode(qm + town, cache, True) if town else None), 0
        if g is None:
            g, prec = geocode(qm, cache, True), 1
        if g is None:
            stat["unplaced"] += 1
            continue
        start = ym(r[c_start])
        if not start:
            stat["not_started"] += 1  # 運転開始前（廃棄時期の推定の対象外）
            continue
        kw = num(r[c_pv]) or num(r[c_kw])
        if not kw:
            stat["unplaced"] += 1
            continue
        if muni not in mi:
            mi[muni] = len(munis)
            munis.append(muni)
        stat["town" if prec == 0 else "muni"] += 1
        out.append([round(g[1], 4), round(g[0], 4), round(kw, 1), start, ym(r[c_fit]), serial_ym(r[c_cert]), prec, mi[muni]])

    fac = []
    for f in FACILITIES:
        g = geocode(f["geo_q"], cache, True)
        if g is None and not offline:
            g = geocode(f["geo_q"], cache, False)
            save_cache(cache)
        if g is None:
            sys.exit(f"処分業者の位置が取れません: {f['name']} {f['address']}")
        fac.append({**{k: v for k, v in f.items() if k != "geo_q"}, "lon": round(g[0], 5), "lat": round(g[1], 5), "geocoded_as": g[2]})

    meta = {
        "prefecture": "京都府",
        "plants_source": "資源エネルギー庁 再生可能エネルギー電子申請サイト 事業計画認定情報 公表用ウェブサイト（京都府ファイル）",
        "plants_url": FIT_PAGE, "terms_url": "https://www.fit-portal.go.jp/Terms",
        "as_of": "2026-09-30", "published": "2026-10-14", "retrieved": "2026-11-12",
        "geocoder": "国土地理院 住所検索API（町字の代表点。町字が引けない設備は市区町村の代表点）",
        "facilities_source": "京都府「太陽光パネルの3R・適正処理について」（更新日2026年3月5日）4.京都府内の太陽光パネルのリサイクル業者",
        "facilities_url": "https://www.pref.kyoto.jp/sanpai/pvpanerutekiseisyori.html",
        "stats": stat, "real_data": True,
        "cols": ["lat", "lon", "kw", "start_ym", "fit_end_ym", "cert_ym", "precision", "muni"],
        "precision": {"0": "町字", "1": "市区町村"},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "plants.json").write_text(json.dumps({"meta": meta, "munis": munis, "rows": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "facilities.json").write_text(json.dumps(fac, ensure_ascii=False, indent=1), encoding="utf-8")
    print("plants:", len(out), stat)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
