"""odpt-2026 の生成済みデータ（web/data）を、この単独アプリの web/data/ にコピーして検証する。

odpt 側は読むだけで、変更しない。到達診断と「路線を止めたら？」の再計算は、odpt の lifemap が
ビルド時に行った結果をそのまま使う。このスクリプトでは人数を足したり推定したりしない。
usage: python3 build_data.py
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent.parent / "odpt-2026" / "app" / "web" / "data"
DST = HERE / "web" / "data"


def main():
    DST.mkdir(parents=True, exist_ok=True)
    index = json.loads((SRC / "index.json").read_text(encoding="utf-8"))
    names = ["index.json"]
    for r in index["regions"]:
        rid = r["id"]
        d = json.loads((SRC / f"{rid}.json").read_text(encoding="utf-8"))
        w = json.loads((SRC / f"whatif_{rid}.json").read_text(encoding="utf-8"))
        n_routes = len(d["routes"])
        for k, diffs in w["routes"].items():
            if not (0 <= int(k) < n_routes):
                sys.exit(f"{rid}: whatif の路線番号 {k} が routes の範囲外")
            for cell, _lv in diffs:
                if not (0 <= cell < len(d["cells"])):
                    sys.exit(f"{rid}: whatif のセル番号 {cell} が範囲外")
        names += [f"{rid}.json", f"whatif_{rid}.json"]
    for n in names:
        shutil.copyfile(SRC / n, DST / n)
    print("copied", len(names), "files to", DST)


if __name__ == "__main__":
    main()
