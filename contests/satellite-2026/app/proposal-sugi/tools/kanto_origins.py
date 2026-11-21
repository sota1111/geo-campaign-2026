#!/usr/bin/env python3
"""50km圏の起点（県庁所在地・政令指定都市・中核市・施行時特例市）の位置を、国土地理院の地名検索API（GET）で取得して
tools/kanto_origins.json に書く。東京都区部は市ではないので、ここでは扱わない（kanto_build.py が行政区域の23区の合併から作る）。

対象は関東にかかる、または関東の外縁から約100km以内の都市（関東の外の都市も、50km圏が関東にかかるので含める）。
区分の出典（いずれも総務省）:
  指定都市一覧 https://www.soumu.go.jp/main_sosiki/jichi_gyousei/bunken/shitei_toshi-ichiran.html （令和4年7月5日現在）
  中核市一覧 https://www.soumu.go.jp/main_content/000885088.pdf （令和5年4月1日現在）
  施行時特例市一覧 https://www.soumu.go.jp/main_content/000885089.pdf （令和5年4月1日現在。制度は平成27年に廃止、施行時特例市は残る）
県庁所在地は各県の県庁がある市。位置は「県名＋市名」の地名検索の代表点（市役所付近とは限らない）。
使い方: python3 -I tools/kanto_origins.py
"""
import json, os, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q='
# (県, 市, 区分のリスト)。区分: 県庁所在地 / 政令指定都市 / 中核市 / 施行時特例市
ORIGINS = [
    ('茨城県', '水戸市', ['県庁所在地', '中核市']), ('茨城県', 'つくば市', ['施行時特例市']),
    ('栃木県', '宇都宮市', ['県庁所在地', '中核市']),
    ('群馬県', '前橋市', ['県庁所在地', '中核市']), ('群馬県', '高崎市', ['中核市']),
    ('群馬県', '伊勢崎市', ['施行時特例市']), ('群馬県', '太田市', ['施行時特例市']),
    ('埼玉県', 'さいたま市', ['県庁所在地', '政令指定都市']), ('埼玉県', '川越市', ['中核市']),
    ('埼玉県', '川口市', ['中核市']), ('埼玉県', '越谷市', ['中核市']), ('埼玉県', '所沢市', ['施行時特例市']),
    ('埼玉県', '草加市', ['施行時特例市']), ('埼玉県', '春日部市', ['施行時特例市']), ('埼玉県', '熊谷市', ['施行時特例市']),
    ('千葉県', '千葉市', ['県庁所在地', '政令指定都市']), ('千葉県', '船橋市', ['中核市']), ('千葉県', '柏市', ['中核市']),
    ('東京都', '八王子市', ['中核市']),
    ('神奈川県', '横浜市', ['県庁所在地', '政令指定都市']), ('神奈川県', '川崎市', ['政令指定都市']),
    ('神奈川県', '相模原市', ['政令指定都市']), ('神奈川県', '横須賀市', ['中核市']),
    ('神奈川県', '小田原市', ['施行時特例市']), ('神奈川県', '大和市', ['施行時特例市']), ('神奈川県', '平塚市', ['施行時特例市']),
    ('神奈川県', '厚木市', ['施行時特例市']), ('神奈川県', '茅ヶ崎市', ['施行時特例市']),
    ('山梨県', '甲府市', ['県庁所在地', '中核市']),
    ('長野県', '長野市', ['県庁所在地', '中核市']), ('長野県', '松本市', ['中核市']),
    ('新潟県', '新潟市', ['県庁所在地', '政令指定都市']), ('新潟県', '長岡市', ['施行時特例市']), ('新潟県', '上越市', ['施行時特例市']),
    ('静岡県', '静岡市', ['県庁所在地', '政令指定都市']), ('静岡県', '浜松市', ['政令指定都市']),
    ('静岡県', '沼津市', ['施行時特例市']), ('静岡県', '富士市', ['施行時特例市']),
    ('福島県', '福島市', ['県庁所在地', '中核市']), ('福島県', '郡山市', ['中核市']), ('福島県', 'いわき市', ['中核市']),
]


def main():
    out = []
    for pref, city, kinds in ORIGINS:
        with urllib.request.urlopen(urllib.request.Request(API + urllib.parse.quote(pref + city), headers={'User-Agent': 'geo-campaign-demo'}), timeout=30) as r:
            res = json.load(r)
        hit = [x for x in res if x['properties']['title'] == pref + city] or res
        lon, lat = hit[0]['geometry']['coordinates']
        out.append({'pref': pref, 'name': city, 'kinds': kinds, 'lon': lon, 'lat': lat})
        print(pref, city, lon, lat, flush=True)
        time.sleep(0.2)
    json.dump(out, open(os.path.join(HERE, 'kanto_origins.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
