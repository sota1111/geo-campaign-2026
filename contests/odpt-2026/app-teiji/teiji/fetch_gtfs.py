"""各事業者の静的 GTFS（CC BY 4.0、トークン不要の api-public.odpt.org）を data/gtfs/<dataset>.zip に保存する。GET のみ。

    python3 -m teiji.fetch_gtfs [--only a,b] [--refresh]
"""
import argparse
import urllib.request
from pathlib import Path

from .collect import UA, load_sources

ROOT = Path(__file__).resolve().parent.parent


def fetch(url, timeout=180):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    out = ROOT / "data" / "gtfs"
    out.mkdir(parents=True, exist_ok=True)
    for s in load_sources([x for x in a.only.split(",") if x]):
        p = out / f"{s['dataset']}.zip"
        if not s.get("gtfs"):
            print(f"{s['dataset']}: 静的GTFSのURLなし（スキップ）")
            continue
        if p.exists() and not a.refresh:
            print(f"{s['dataset']}: 取得済み")
            continue
        try:
            b = fetch(s["gtfs"])
            if b[:2] != b"PK":
                raise ValueError("zip ではない")
            p.write_bytes(b)
            print(f"{s['dataset']}: {len(b) // 1024} KB")
        except Exception as e:  # noqa: BLE001
            print(f"{s['dataset']}: 失敗 {e}")


if __name__ == "__main__":
    main()
