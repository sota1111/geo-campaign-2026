#!/usr/bin/env python3
"""名前のある OSM 建物の近く（半径60m）にある Wikimedia Commons の画像を GET で探し、ライセンス・作者を取る。
使い方: python3 -I tools/fetch_commons.py <osm_match.json> <出力JSON>
候補は、(1) 画像の座標が建物から60m以内、(2) ライセンスが CC BY / CC BY-SA / CC0 / パブリックドメイン、のものだけ。
建物の写真かどうかは人が目で確認して web/data/photos.json に採用する（このスクリプトは候補を出すだけ）。"""
import json, sys, time, urllib.request, urllib.parse, os

API = 'https://commons.wikimedia.org/w/api.php?'
UA = {'User-Agent': 'geo-campaign-2026-research/1.0 (contact: repository owner)'}


def get(params):
    req = urllib.request.Request(API + urllib.parse.urlencode(params), headers=UA)
    for wait in (2, 5, 15, 40, 90):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(wait)
    raise SystemExit('429 が続いたので止める')


def main():
    m = json.load(open(sys.argv[1]))['items']
    here = os.path.dirname(os.path.abspath(__file__))
    bd = {b['id']: b for b in json.load(open(os.path.join(here, '..', 'web', 'data', 'buildings.json')))['buildings']}
    out = []
    for it in m:
        if not it['name']:
            continue
        b = bd[it['id']]
        g = get({'action': 'query', 'list': 'geosearch', 'gscoord': '%f|%f' % (b['lat'], b['lon']), 'gsradius': 60,
                 'gsnamespace': 6, 'gslimit': 10, 'format': 'json'})
        for r in g.get('query', {}).get('geosearch', []):
            info = get({'action': 'query', 'titles': r['title'], 'prop': 'imageinfo', 'iiprop': 'url|extmetadata',
                        'iiurlwidth': 320, 'format': 'json'})
            for p in info['query']['pages'].values():
                ii = p.get('imageinfo', [{}])[0]
                em = ii.get('extmetadata', {})
                out.append({'id': it['id'], 'name': it['name'], 'title': r['title'], 'dist': r['dist'],
                            'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
                            'license': em.get('LicenseShortName', {}).get('value'),
                            'licenseUrl': em.get('LicenseUrl', {}).get('value'),
                            'artist': em.get('Artist', {}).get('value'),
                            'desc': em.get('ImageDescription', {}).get('value')})
            time.sleep(1.0)
        time.sleep(1.0)
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
    print(len(out), 'candidates')


main()
