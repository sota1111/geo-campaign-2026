#!/usr/bin/env python3
"""東京都12地点の9年分（2009〜2017年）のスギ・ヒノキ亜科の飛散花粉数（ダーラム法、個/cm2）を、原表から機械で読んで
tools/kanto_verify9.json と data/verify9.js に書く（GET のみ。pdftotext が必要）。
出典: 横山敏孝（林業科学技術振興所）「スギ林のスギ雄花着花状況調査による予測」東京都花粉症対策検討委員会 平成29年度第2回 資料3
  https://www.tmiph.metro.tokyo.lg.jp/files/kj_kankyo/kafun/iinkai/kaisaijoukyou_h29_02/H29-2-kafun-shiryou3.pdf
  表2（2018年花粉飛散数予測の解析データ。西暦ごとの雄花数と12地点の飛散花粉数）、表3（回帰係数と自由度修正済決定係数）。
地点の位置は tools/kanto_verify.json（地理院の地名検索による区市の代表点）を再利用する。
読み取りの検査: 各年が12地点の数字を持つこと、2009〜2017の9行であること、表3の「観測年数」が9であること。
使い方: python3 -I tools/kanto_verify9.py [PDFの保存先ディレクトリ]
"""
import json, os, re, subprocess, sys, tempfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'https://www.tmiph.metro.tokyo.lg.jp/files/kj_kankyo/kafun/iinkai/kaisaijoukyou_h29_02/H29-2-kafun-shiryou3.pdf'
NAMES = ['千代田', '葛飾', '杉並', '北', '大田', '青梅', '八王子', '町田', '小平', '多摩', '立川', '府中']  # 表2・表3の列の並び


def nums(s):
    return [float(x.replace(',', '')) for x in re.findall(r'-?[\d,]+\.?\d*', s)]


def parse(text):
    a = re.search(r'^\s*表２\s*2018', text, flags=re.M).start(); b = re.search(r'^\s*表３\s*2018', text, flags=re.M).start()
    t2 = text[a:b]
    years = {}
    for line in t2.splitlines():
        m = re.match(r'\s*(20\d\d)\s+(\d\d)\s+(.*)$', line)
        if m:
            v = nums(m.group(3))
            if len(v) == 13:  # 雄花数 + 12地点
                years[int(m.group(1))] = {'bloom': v[0], 'sites': dict(zip(NAMES, v[1:]))}
    t3 = text[b:]
    coef = {}
    for key, lab in (('coef', '回帰係数'), ('const', '定数項'), ('r2', '決定係数 R2'), ('years', '観測年数'), ('pred', '予測花粉数/cm2')):
        m = re.search(r'^\s*' + re.escape(lab) + r'\s+(.*)$', t3, flags=re.M)
        v = nums(m.group(1))
        assert len(v) == 12, (lab, v)
        coef[key] = dict(zip(NAMES, v))
    return years, coef


def main(work=None):
    work = work or tempfile.mkdtemp()
    os.makedirs(work, exist_ok=True)
    pdf = os.path.join(work, 'n4.pdf')
    if not os.path.exists(pdf):
        req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
        open(pdf, 'wb').write(urllib.request.urlopen(req, timeout=120).read())
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    years, coef = parse(text)
    assert sorted(years) == list(range(2009, 2018)), sorted(years)
    assert all(v == 9 for v in coef['years'].values())
    base = json.load(open(os.path.join(HERE, 'kanto_verify.json'), encoding='utf-8'))['tokyo']['sites']
    pos = {s['name']: (s['lon'], s['lat']) for s in base}
    sites = []
    for n in NAMES:
        vals = [years[y]['sites'][n] for y in range(2009, 2018)]
        sites.append({'name': n, 'lon': pos[n][0], 'lat': pos[n][1], 'byYear': vals, 'mean9': round(sum(vals) / 9, 1),
                      'coef': coef['coef'][n], 'r2': coef['r2'][n]})
    out = {'source': URL, 'what': '東京都12地点のスギ・ヒノキ亜科の飛散花粉数（ダーラム法、個/cm2）2009〜2017年（9年）。表2。coef は表3の回帰係数（県平均の雄花数1個/m2あたりの飛散数）、r2 は自由度修正済決定係数',
           'years': list(range(2009, 2018)), 'bloomByYear': [years[y]['bloom'] for y in range(2009, 2018)], 'fetched': '2026-11-21', 'sites': sites}
    json.dump(out, open(os.path.join(HERE, 'kanto_verify9.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, 'data', 'verify9.js'), 'w', encoding='utf-8') as f:
        f.write('// tools/kanto_verify9.py が生成。東京都 花粉症対策検討委員会 平成29年度第2回 資料3 の表2・表3を機械で読んだ実データ。手で編集しない。\n')
        f.write('window.SUGI_VERIFY9 = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    for s in sites:
        print(s['name'], s['mean9'], s['coef'], s['r2'])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
