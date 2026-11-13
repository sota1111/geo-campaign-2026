"""ODPT の CKAN（ckan.odpt.org）から、CC BY 4.0 のバス関連リアルタイム情報のリソースを探す。

CKAN の JSON API（/api/3/）は HTML を返す設定のため、公開ページ（HTML）を GET して読む。
取得は GET のみ・トークン不要。ライセンスは検索条件（license_id=CC-BY-4.0）に加え、
データセットページの本文でも確認し、CC BY 4.0 と読めないものは採用しない。

出力（data/sources.json）: [{dataset, title, org, license, resources:[{kind, format, url, title}]}]
kind は VehiclePosition / TripUpdate / Alerts / GTFS / other。
"""
import html
import re
import time
import urllib.parse
import urllib.request

CKAN = "https://ckan.odpt.org"
UA = {"User-Agent": "bus-teiji-karte/0.1 (research; GET only)"}
TAG_BUS_RT = "バス関連リアルタイム情報-bus_realtime_information"


def get(url, timeout=30, retries=3):
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + i)
    raise RuntimeError(f"取得失敗 {url}: {last}")


def list_dataset_ids(license_id="CC-BY-4.0", tag=TAG_BUS_RT, max_pages=10):
    ids = []
    for p in range(1, max_pages + 1):
        q = urllib.parse.urlencode({"tags": tag, "license_id": license_id, "page": p})
        h = get(f"{CKAN}/dataset/?{q}")
        found = [d for d in re.findall(r'href="/dataset/([^"?/]+)"', h) if d not in ids]
        found = list(dict.fromkeys(found))
        if not found:
            break
        ids += found
    return ids


def classify(title, fmt, url):
    """リソースの種類。ODPT の公開URLは末尾が _vehicle / _trip_update / _alert（都営バスのみ ToeiBus）。"""
    u = url.lower()
    if u.endswith("_vehicle") or u.endswith("/toeibus"):
        return "VehiclePosition"
    if u.endswith("_trip_update"):
        return "TripUpdate"
    if u.endswith("_alert"):
        return "Alerts"
    if "gtfs" in u and u.endswith(".zip"):
        return "GTFS"
    return "other"


def parse_dataset(dataset_id):
    h = get(f"{CKAN}/dataset/{dataset_id}")
    title = re.search(r"<title>(.*?)</title>", h, re.S)
    title = html.unescape(title.group(1).strip().split("\n")[0].split(" - ")[0].strip()) if title else dataset_id
    lic = ""
    m = re.search(r'<a href="(https://creativecommons\.org/licenses/[^"]+)" rel="dc:rights">([^<]+)</a>', h)
    if m:
        lic = html.unescape(m.group(2)).strip()
    org = re.search(r'/dataset/\?organization=([^"&]+)', h)
    gtfs = list(dict.fromkeys(re.findall(r'https://api-public\.odpt\.org/api/v4/files/[^"?<> ]+\.zip\?date=current', h)))
    rids = list(dict.fromkeys(re.findall(rf"/dataset/{re.escape(dataset_id)}/resource/([0-9a-f-]+)", h)))
    resources = []
    for rid in rids:
        rh = get(f"{CKAN}/dataset/{dataset_id}/resource/{rid}")
        mt = re.search(r"<title>(.*?)</title>", rh, re.S)
        rtitle = html.unescape(mt.group(1).strip().split("\n")[0].split(" - ")[0].strip()) if mt else rid
        mu = re.search(r'class="resource-url-analytics" href="([^"]+)"', rh)
        mf = re.search(r"<th[^>]*>\s*フォーマット\s*</th>\s*<td>([^<]*)</td>", rh) or re.search(r"<td>(Protocol Buffers|JSON|ZIP|GTFS[^<]*)</td>", rh)
        url = html.unescape(mu.group(1)) if mu else ""
        fmt = mf.group(1).strip() if mf else ""
        resources.append({"kind": classify(rtitle, fmt, url), "format": fmt, "url": url, "title": rtitle})
    return {"dataset": dataset_id, "title": title, "org": org.group(1) if org else "", "license": lic,
            "page": f"{CKAN}/dataset/{dataset_id}", "gtfs_urls": gtfs, "resources": resources}


def discover(license_id="CC-BY-4.0"):
    out = []
    for d in list_dataset_ids(license_id):
        try:
            out.append(parse_dataset(d))
        except Exception as e:  # noqa: BLE001
            out.append({"dataset": d, "error": str(e), "resources": []})
    return out


def usable(ds):
    """トークン不要（api-public.odpt.org）で CC BY 4.0 と確認でき、GTFS-RT と読めるリソースだけ。"""
    if "CC BY 4.0" not in ds.get("license", ""):
        return []
    return [r for r in ds["resources"]
            if r["url"].startswith("https://api-public.odpt.org/") and "gtfs/realtime" in r["url"]
            and "acl:consumerKey" not in r["url"]]
