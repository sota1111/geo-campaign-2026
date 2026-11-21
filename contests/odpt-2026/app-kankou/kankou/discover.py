"""ODPT の CKAN（ckan.odpt.org）の公開ページを GET して、観光都市のデータセットを探す。取得は GET のみ・トークン不要。

使い方: python3 -m kankou.discover 京都 鎌倉 ...
"""
import re
import sys
import urllib.parse
import urllib.request

UA = {"User-Agent": "kankou-route-research/0.1 (GET only)"}


def search(q, timeout=60):
    u = "https://ckan.odpt.org/dataset/?" + urllib.parse.urlencode({"q": q})
    h = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout).read().decode()
    return sorted(set(re.findall(r'href="/dataset/([^"?/]+)"', h)))


def list_license(license_id="CC-BY-4.0", max_pages=20):
    """ライセンスで絞った ODPT データセットID一覧（公開ページを GET）。"""
    seen = []
    for page in range(1, max_pages + 1):
        q = urllib.parse.urlencode({"license_id": license_id, "page": page})
        h = urllib.request.urlopen(urllib.request.Request("https://ckan.odpt.org/dataset/?" + q, headers=UA), timeout=60).read().decode()
        found = [d for d in dict.fromkeys(re.findall(r'href="/dataset/([^"?/]+)"', h)) if d not in seen]
        if not found:
            break
        seen += found
    return seen


if __name__ == "__main__":
    if sys.argv[1:] == ["--license"]:
        print(list_license())
        sys.exit(0)
    for q in sys.argv[1:]:
        try:
            print(q, search(q))
        except Exception as e:  # noqa: BLE001
            print(q, "ERR", e)
