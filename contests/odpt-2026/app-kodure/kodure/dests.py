"""行き先（子連れのお出かけ先）: 国土数値情報 都市公園 P13 と 文化施設 P27 の読み込み。

- P13（2011年度版・データ基準 2010年3月）: 公園名・公園種別コード(P13_004)・供用済面積(P13_008, m2)。
  公園は面積で2段階に絞る（既定: 1ha 以上）。種別コード 10=緩衝緑地・12=緑道 は細長く「遊びに行く先」の中心点で
  表せないので除く。
- P27（2013年度版）: 文化施設分類コード(P27_004)。03004=水族館、03005=動植物園、03002=博物館・資料館・科学館等。
  美術館(03001)・図書館(03003)・その他の公共施設は子連れの行き先として扱わない（総司令官の指示の範囲外）。
  動植物園(03005)は施設名に「動物」を含むものを動物園、それ以外を植物園・生物園等に分ける（名称による推定）。
どちらも一覧ページに「非商用」の使用許諾表示がある（README・画面の出典に条件を書く）。
"""
import math

from . import shp

PARK_MIN_M2 = 10000        # この面積未満の公園は行き先にしない
PARK_LARGE_M2 = 100000     # 大きい公園の境（10ha）
PARK_EXCLUDED_TYPES = {"10", "12"}   # 緩衝緑地・緑道
PARK_TYPE_LABEL = {"1": "街区公園", "2": "近隣公園", "3": "地区公園", "4": "総合公園", "5": "運動公園", "6": "広域公園",
                   "7": "レクリエーション都市", "8": "国営公園", "9": "特殊公園", "11": "都市緑地", "13": "都市林",
                   "14": "広場公園"}

# 行き先の種類（画面の絞り込みの単位）。順序は画面の並び順
KINDS = [
    ("park_l", "大きい公園（10ha以上）"),
    ("park_m", "公園（1〜10ha）"),
    ("zoo", "動物園"),
    ("aquarium", "水族館"),
    ("museum", "博物館・科学館・資料館等"),
    ("botanical", "植物園・生物園等"),
]
P27_KIND = {"03002": "museum", "03004": "aquarium", "03005": "zoo_or_botanical"}


def in_bbox(lon, lat, bbox):
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def read_parks(zip_path, bbox, min_m2=PARK_MIN_M2):
    """P13 -> [(経度, 緯度, 名前, kind, 面積m2, 種別名)]。bbox 内、面積が min_m2 以上のもの。"""
    out = []
    for lon, lat, r in shp.read_points_zip(zip_path):
        if not in_bbox(lon, lat, bbox):
            continue
        t = r.get("P13_004", "")
        if t in PARK_EXCLUDED_TYPES:
            continue
        a = int(r["P13_008"]) if r.get("P13_008", "").lstrip("-").isdigit() else 0
        name = r.get("P13_003", "")
        if a < min_m2 or not name:
            continue
        out.append((lon, lat, name, "park_l" if a >= PARK_LARGE_M2 else "park_m", a, PARK_TYPE_LABEL.get(t, "")))
    return out


def classify_p27(code, name):
    k = P27_KIND.get(code)
    if k == "zoo_or_botanical":
        return "zoo" if "動物" in name else "botanical"
    return k


def read_culture(zip_path, bbox):
    """P27 -> [(経度, 緯度, 名前, kind, 0, 分類名)]。動物園・水族館・博物館等・植物園等のみ。"""
    label = {"museum": "博物館・資料館・科学館等", "aquarium": "水族館", "zoo": "動物園", "botanical": "植物園・生物園等"}
    out = []
    for lon, lat, r in shp.read_points_zip(zip_path):
        if not in_bbox(lon, lat, bbox):
            continue
        name = r.get("P27_005", "")
        k = classify_p27(r.get("P27_004", ""), name)
        if k and name:
            out.append((lon, lat, name, k, 0, label[k]))
    return out


# P27（2013年度版）に残っている、現在は閉館している施設（確認できたものだけ。網羅ではない）
CLOSED = {"逓信総合博物館"}   # 2013年8月に閉館（郵政博物館として移転）

RING_POINTS = 8             # 公園の外周の入口候補の数
RING_MAX_M = 700            # 等価半径の上限（極端に大きい面積での暴走を避ける）


def dedupe(items, tol=0.0003):
    """同名で約30m以内の重複を1つにまとめる（P27 に同じ施設が複数の分類で入っていることがある）。
    座標の丸めの区切りをまたぐ重複も除く（隣り合う区画も調べる）。"""
    seen = {}
    out = []
    for it in items:
        gx, gy = round(it[0] / tol), round(it[1] / tol)
        dup = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (x, y) in seen.get((it[2], gx + dx, gy + dy), ()):
                    if abs(x - it[0]) <= tol and abs(y - it[1]) <= tol:
                        dup = True
        if dup:
            continue
        seen.setdefault((it[2], gx, gy), []).append((it[0], it[1]))
        out.append(it)
    return out


def equivalent_radius_m(area_m2):
    """面積と同じ円の半径（m）。公園の形状（P13 は点データ）が無いため、円形と仮定した外周までの距離として使う。"""
    return min(RING_MAX_M, math.sqrt(max(area_m2, 0) / math.pi))


def access_points(lon, lat, kind, area_m2, n=RING_POINTS):
    """行き先の入口の候補 [(lat, lon)]。公園（面積あり）は、中心点ではなく、中心から等価半径だけ離れた外周の n 点（円形と仮定した
    入口の候補）と中心。人はその中の最も近い点から入る・出るものとして扱う。文化施設は施設の点だけ。"""
    pts = [(lat, lon)]
    if kind in ("park_l", "park_m") and area_m2 > 0:
        r = equivalent_radius_m(area_m2)
        kx = 111320.0 * math.cos(math.radians(lat))
        for k in range(n):
            th = 2 * math.pi * k / n
            pts.append((lat + r * math.sin(th) / 110574.0, lon + r * math.cos(th) / kx))
    return pts


def read_destinations(p13_zip, p27_zip, bbox):
    items = read_parks(p13_zip, bbox) + read_culture(p27_zip, bbox)
    items = [it for it in items if it[2] not in CLOSED]
    items = dedupe(items)
    items.sort(key=lambda x: (x[3], -x[4], x[2]))
    return items
