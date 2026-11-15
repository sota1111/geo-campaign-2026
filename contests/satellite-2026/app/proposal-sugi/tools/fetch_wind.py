#!/usr/bin/env python3
"""気象庁「過去の気象データ検索」の日ごとの値（アメダス青梅、地点番号 prec_no=44 / block_no=1001）から、
花粉の時期（2〜4月）の「最多風向」（日ごとに16方位）を集計し wind.json に書き出す（GET のみ）。
出力: <出力ディレクトリ>/wind.json = {"counts": {方位: 日数}, "days": 日数, "years": [...], "months": [...]}
使い方: python3 -I tools/fetch_wind.py <出力ディレクトリ>
"""
import json, os, re, sys, time, urllib.request

YEARS = (2023, 2024, 2025)
MONTHS = (2, 3, 4)
URL = 'https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=44&block_no=1001&year=%d&month=%d&day=&view='
DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西']


def parse(html):
    out = []
    for r in re.findall(r'<tr class="mtx"[^>]*>(.*?)</tr>', html, re.S):
        c = [re.sub(r'<[^>]*>', '', x).strip() for x in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
        if len(c) >= 15 and c[0].isdigit():
            out.append(c[14])  # 最多風向（日ごとの値の表で、日・降水3・気温3・湿度2・風速系・最多風向 の並び）
    return out


def main(out):
    counts = {d: 0 for d in DIRS}
    days = 0
    for y in YEARS:
        for m in MONTHS:
            with urllib.request.urlopen(URL % (y, m), timeout=60) as r:
                vals = parse(r.read().decode('utf-8'))
            for v in vals:
                if v in counts:
                    counts[v] += 1
                    days += 1
            time.sleep(1)
    os.makedirs(out, exist_ok=True)
    json.dump({'counts': counts, 'days': days, 'years': list(YEARS), 'months': list(MONTHS)}, open(os.path.join(out, 'wind.json'), 'w'), ensure_ascii=False)
    print(days, 'days', counts)


if __name__ == '__main__':
    main(sys.argv[1])
