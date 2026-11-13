"""新旧比較用の事前生成画像・輪郭データを、偵察隊の sandbox（取得済み地理院タイル）から作る。
実行: python3 contests/dashboard/scripts/build-imgproc-assets.py [sandbox/recon の場所]
ネットワークには接続しない。出力は各アプリの img/ と sites.ts / oldchannel.ts（コミット対象）。
加工内容: 切出し（512×512）、CLAHE（clipLimit=2, 8×8。旧白黒写真はグレースケール、カラーは Lab の L のみ）、JPEG 化。
出典: 国土地理院 地理院タイル（加工）。個別撮影年は未確認。"""
import json, math, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
DASH = HERE.parent
REPO = DASH.parents[1]
SB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/home/ubuntu/dev/2026/geo-campaign-2026/sandbox/recon')
CH = SB / 'chimei-imgproc'
MO = SB / 'moritsuchi-imgproc'
Q = 86


def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert('RGB').save(path, quality=Q, optimize=True)


def clahe_gray(im):
    g = cv2.cvtColor(np.array(im.convert('RGB')), cv2.COLOR_RGB2GRAY)
    c = cv2.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply(g)
    return Image.fromarray(cv2.cvtColor(c, cv2.COLOR_GRAY2RGB))


def clahe_lab(im):
    lab = cv2.cvtColor(np.array(im.convert('RGB')), cv2.COLOR_RGB2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    return Image.fromarray(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB))


# ---- ichibiz: 地名の記憶マップ s1 周辺（z16 / x=56886..56888 左から250px / y=26073..26074） ----
def ll16(px, py):
    X = 56886 * 256 + 250 + px
    Y = 26073 * 256 + py
    n = 256 * 2 ** 16
    return [round(X / n * 360 - 180, 6), round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n)))), 6)]


def chimei():
    out = DASH / 'src/apps/biz-idea/img'
    old = Image.open(CH / 'ort_old10.png')
    save(old, out / 's1-old.jpg')
    save(clahe_gray(old), out / 's1-old-clahe.jpg')
    save(Image.open(CH / 'seamlessphoto.png'), out / 's1-new.jpg')
    # D: 治水地形分類図の旧河道記号（青い横線）の色抽出 → closing → 輪郭 → 単純化。s1 周辺を元図（lcmfc2.png）と重ねて目視照合した
    lc = np.array(Image.open(CH / 'lcmfc2.png').convert('RGB')).astype(int)
    r, g, b = lc[:, :, 0], lc[:, :, 1], lc[:, :, 2]
    blue = ((b > 130) & (r < 110) & (g > 65) & (g < 175) & ((b - r) > 70)).astype('uint8') * 255
    j = cv2.morphologyEx(blue, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    cs, _ = cv2.findContours(j, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    kept = [c for c in cs if cv2.contourArea(c) > 160]
    feats = []
    for c in kept:
        a = cv2.approxPolyDP(c, 2.0, True)[:, 0, :]
        pts = [ll16(int(x), int(y)) for x, y in a]
        pts.append(pts[0])
        feats.append({'type': 'Feature', 'properties': {'label': '治水地形分類図の旧河道（輪郭は目安）'},
                      'geometry': {'type': 'LineString', 'coordinates': pts}})
    gj = {'type': 'FeatureCollection', 'features': feats}
    (DASH / 'src/apps/biz-idea/oldchannel.ts').write_text(
        '/* 治水地形分類図（国土地理院）の旧河道記号（青い横線）を色抽出して作った輪郭の目安。公式のベクタ境界データではない。\n'
        '   s1 周辺（約1km四方）のみ。scripts/build-imgproc-assets.py で生成。「ここが昔の川」を示すものではない */\n'
        "import type { FeatureCollection, LineString } from 'geojson'\n"
        'export const S1_OLD_CHANNEL: FeatureCollection<LineString> = ' + json.dumps(gj, ensure_ascii=False, separators=(',', ':')) + '\n')
    # 目視照合用（元図に輪郭を重ねた画像）。コミットしない
    a = np.array(Image.open(CH / 'lcmfc2.png').convert('RGB'))
    for c in kept:
        cv2.polylines(a, [cv2.approxPolyDP(c, 2.0, True)], True, (255, 0, 0), 2)
    Image.fromarray(a).resize((1024, 1024)).save(DASH / 'screenshots/_check-oldchannel.png') if (DASH / 'screenshots').exists() else None
    print('chimei: contours', len(kept), 'bounds', ll16(0, 0), ll16(512, 512))


# ---- udc: 盛土ウォッチ 3地点 ----
def xy(lon, lat, z=17):
    return ((lon + 180) / 360 * 256 * 2 ** z, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 256 * 2 ** z)


def moritsuchi():
    out = DASH / 'src/apps/udc-moritsuchi/img'
    F = json.load(open(REPO / 'contests/udc-2026/app/moritsuchi-watch/data/fills.geojson'))['features'] \
        if (REPO / 'contests/udc-2026/app/moritsuchi-watch/data/fills.geojson').exists() else None
    if F is None:
        F = json.load(open(DASH / 'public/data/udc-moritsuchi/fills.geojson'))['features']
    sites = json.load(open(MO / 'sites.json'))
    for key, label in [('atami', 'atami'), ('ito', 'ito')]:
        o61 = Image.open(MO / f'{key}_ort_old10.png')
        o74 = Image.open(MO / f'{key}_gazo1.png')
        save(o61, out / f'{key}-old61.jpg')
        save(clahe_gray(o61), out / f'{key}-old61-clahe.jpg')
        save(o74, out / f'{key}-old74.jpg')
        save(clahe_lab(o74), out / f'{key}-old74-clahe.jpg')
        save(Image.open(MO / f'{key}_seamlessphoto.png'), out / f'{key}-new.jpg')
        save(Image.open(MO / f'{key}_hillshademap.png'), out / f'{key}-hill.jpg')
    res = {}
    for s in sites:
        res[s['id']] = {'key': s['sid'].split('-')[0], 'ox': s['originWorldPixelZ17'][0], 'oy': s['originWorldPixelZ17'][1]}
    (DASH / 'src/apps/udc-moritsuchi/sites.ts').write_text(
        '/* 事前生成した比較画像（img/）の位置。ox, oy は 512×512 画像の左上の世界画素座標（Web Mercator z17、北が上）。\n'
        '   scripts/build-imgproc-assets.py で生成。画像は地理院タイルの切出し・CLAHE 補正・JPEG 化（加工）。個別撮影年は未確認 */\n'
        'export const SITE_VIEW: Record<string, { key: string; ox: number; oy: number }> = '
        + json.dumps(res, ensure_ascii=False, separators=(',', ':')) + '\n')
    print('moritsuchi:', list(res))


if __name__ == '__main__':
    chimei()
    moritsuchi()
