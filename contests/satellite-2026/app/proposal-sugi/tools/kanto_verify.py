#!/usr/bin/env python3
"""検証用の公開データを GET で取得して tools/kanto_verify.json に書く。
 1. 東京都 飛散花粉数データ（スギ）の「1月5日以降のスギ花粉の累積値」12地点（個/cm2）。年はページに書かれておらず、
    1/5 が月曜・5/4 が月曜であることから2026年と判断（2026-11-21 時点のページ）。地点の位置は「東京都＋区市名」の地名検索（区市の代表点。観測地点そのものではない）。
    出典: https://www.hokeniryo1.metro.tokyo.lg.jp/allergy/pollen/data/cedar.html
 2. 環境省・林野庁「令和6年度スギ雄花花芽調査結果」の関東7都県（令和6年度の値と過去10年平均値、個/m2）。
    出典: https://www.env.go.jp/content/000278567.pdf  （pdftotext が必要）
使い方: python3 -I tools/kanto_verify.py
"""
import json, os, re, subprocess, tempfile, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'Mozilla/5.0'}
TOKYO = 'https://www.hokeniryo1.metro.tokyo.lg.jp/allergy/pollen/data/cedar.html'
BLOOM = 'https://www.env.go.jp/content/000278567.pdf'
GSI = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q='
SITES = {'千代田': '千代田区', '葛飾': '葛飾区', '杉並': '杉並区', '北': '北区', '大田': '大田区', '青梅': '青梅市', '八王子': '八王子市',
         '多摩': '多摩市', '町田': '町田市', '立川': '立川市', '府中': '府中市', '小平': '小平市'}
PREFS = ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def main():
    h = get(TOKYO).decode('utf-8', 'ignore')
    t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)))
    m = re.search(r'1月5日以降のスギ花粉の累積値（単位：個/cm 2 ） ((?:\S+ ){12})((?:[\d.]+ ){12})', t)
    names, vals = m.group(1).split(), [float(x) for x in m.group(2).split()]
    assert names == list(SITES), names
    sites = []
    for n, v in zip(names, vals):
        q = '東京都' + SITES[n]
        res = json.loads(get(GSI + urllib.parse.quote(q)))
        hit = [x for x in res if x['properties']['title'] == q] or res
        lon, lat = hit[0]['geometry']['coordinates']
        sites.append({'name': n, 'place': SITES[n], 'cum': v, 'lon': lon, 'lat': lat})
        time.sleep(0.2)
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'b.pdf')
        open(p, 'wb').write(get(BLOOM))
        txt = subprocess.run(['pdftotext', '-layout', p, '-'], capture_output=True, text=True, check=True).stdout
    bloom = []
    for pref in PREFS:
        mm = re.search(r'^\s*' + pref + r'\s+([\d,]+)\s+([\d,]+)\s+(\d+)', txt, flags=re.M)
        bloom.append({'pref': pref, 'r6': int(mm.group(1).replace(',', '')), 'avg10': int(mm.group(2).replace(',', '')), 'ratio': int(mm.group(3))})
    out = {'tokyo': {'source': TOKYO, 'what': '2026年1月5日以降のスギ花粉の累積値（個/cm2）。年は曜日から判断', 'fetched': '2026-11-21', 'sites': sites},
           'bloom': {'source': BLOOM, 'what': '令和6年度スギ雄花花芽調査結果（個/m2）と過去10年平均値', 'fetched': '2026-11-21', 'prefs': bloom}}
    json.dump(out, open(os.path.join(HERE, 'kanto_verify.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(sites, bloom)


if __name__ == '__main__':
    main()
