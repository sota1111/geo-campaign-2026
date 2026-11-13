"""CKAN から CC BY 4.0 のバス GTFS-RT を探し、data/sources.json を作る。

    python3 -m teiji.discover            # ネットワーク取得（GETのみ）
静的 GTFS の URL がデータセットページに無い場合は、RT の URL（odpt_<組織>_<名前>_vehicle）から
files/odpt/<組織>/<名前>.zip を推定して GET で存在確認する（取れなければ gtfs_url は空のまま）。
"""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from . import ckan

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://api-public.odpt.org/api/v4/files/"


# CKAN ページに静的 GTFS の URL が出ない事業者（現行アプリ regions.json で使用済みの URL）
KNOWN_GTFS = {"b_bus_gtfs_rt-toei": FILES + "Toei/data/ToeiBus-GTFS.zip"}


def probe(url, timeout=90):
    try:
        req = urllib.request.Request(url, headers=ckan.UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
        return b[:2] == b"PK"
    except (urllib.error.URLError, OSError):
        return False


def guess_gtfs(ds):
    rt = [r["url"] for r in ds["resources"] if r["kind"] == "VehiclePosition"]
    for u in rt:
        m = re.search(r"realtime/odpt_([^_]+)_(.+)_vehicle$", u)
        if m:
            cand = f"{FILES}odpt/{m.group(1)}/{m.group(2)}.zip?date=current"
            if probe(cand):
                return cand
    return ""


def clean_name(t):
    """「【リアルタイム情報】高知高陵交通 路線バス / [realtime ...]」 -> 「高知高陵交通 路線バス」"""
    t = re.sub(r"^【[^】]*】", "", t.split(" / ")[0]).strip()
    return re.sub(r"\s*バス関連リアルタイム情報$", "", t).strip() or t


def main():
    out = []
    for ds in ckan.discover():
        us = ckan.usable(ds)
        if not us:
            continue
        urls = {r["kind"]: r["url"] for r in us}
        g = ds.get("gtfs_urls") or []
        gtfs = g[0] if g else KNOWN_GTFS.get(ds["dataset"]) or guess_gtfs(ds)
        out.append({"dataset": ds["dataset"], "name": clean_name(ds["title"]), "org": ds["org"], "license": ds["license"],
                    "page": ds["page"], "vehicle": urls.get("VehiclePosition", ""),
                    "trip_update": urls.get("TripUpdate", ""), "gtfs": gtfs})
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "sources.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for o in out:
        print(o["dataset"], "RT" if o["vehicle"] else "-", "TU" if o["trip_update"] else "-", "GTFS" if o["gtfs"] else "-")


if __name__ == "__main__":
    main()
