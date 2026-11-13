"""公開サイトから原データを GET で取得して raw/ に置く（POST・認証なし）。raw/ は再配布しない（.gitignore）。

  python3 fetch_raw.py

1. 認定情報（資源エネルギー庁 再エネ電子申請サイト）茨城県ファイル: 公表ページのリンクから都道府県名で探す
2. e-Stat 国勢調査 2020 小地域（町丁・字等）境界 茨城県（世界測地系緯度経度・シェープ。属性表 .dbf の代表点と人口を使う）
3. e-Stat 国勢調査 2020 地域メッシュ統計 人口及び世帯（500m メッシュ）第1次地域区画 5339 5340 5439 5539 5540（茨城県を含む区画）
"""
import html
import re
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
FIT = "https://www.fit-portal.go.jp"
ESTAT = "https://www.e-stat.go.jp/gis/statmap-search/data"
PREF = "茨城県"
MESH1 = ["5339", "5340", "5439", "5440", "5539", "5540"]


def get(url, timeout=300):
    req = urllib.request.Request(url, headers={"User-Agent": "solar-guard-demo (GET only, low frequency)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    RAW.mkdir(exist_ok=True)
    page = get(FIT + "/PublicInfo").decode("utf-8")
    m = re.search(r"(\d{4})年\s*(\d+)月\s*(\d+)日\s*時点", html.unescape(re.sub(r"<[^>]+>", "", page)))
    print("認定情報の時点:", m.group(0) if m else "?")
    link = None
    for a in re.finditer(r'<a href="([^"]*FileDownload[^"]*)"[^>]*>([^<]*)</a>', page):
        if html.unescape(a.group(2)).strip() == PREF:
            link = html.unescape(a.group(1))
    if not link:
        raise SystemExit("公表ページに茨城県のリンクが見つかりません")
    (RAW / "ibaraki.xlsx").write_bytes(get(FIT + link))
    print("ibaraki.xlsx", (RAW / "ibaraki.xlsx").stat().st_size)

    z = RAW / "estat_boundary_r2ka08.zip"
    z.write_bytes(get(ESTAT + "?dlserveyId=A002005212020&code=08&coordSys=1&format=shape&downloadType=5&datum=2000"))
    with zipfile.ZipFile(z) as zf:
        zf.extract("r2ka08.dbf", RAW)
    print("境界", z.stat().st_size)

    (RAW / "estat_mesh").mkdir(exist_ok=True)
    for c in MESH1:
        zp = RAW / "estat_mesh" / f"m{c}.zip"
        zp.write_bytes(get(f"{ESTAT}?statsId=T001100&code={c}&downloadType=2"))
        with zipfile.ZipFile(zp) as zf:
            zf.extractall(RAW / "estat_mesh")
        print("メッシュ", c, zp.stat().st_size)


if __name__ == "__main__":
    main()
