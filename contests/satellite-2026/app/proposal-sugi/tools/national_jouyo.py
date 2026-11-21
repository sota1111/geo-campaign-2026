#!/usr/bin/env python3
"""総務省「令和6年度 森林環境譲与税 譲与額（都道府県別・市区町村別）」PDF（2ページ以降が市区町村別。単位: 千円）を GET で取得し、
市区町村別の譲与額を tools/jouyo_r6.json に書く。農林業センサス2020「市町村別私有林人工林面積及び林野率」の Excel も GET して
tools/census2020_private.json に書く（私有林人工林面積 ha。国有林は含まない）。pdftotext（poppler）と openpyxl が必要。
使い方: python3 -I tools/national_jouyo.py <作業ディレクトリ>
出典: https://www.soumu.go.jp/main_content/001001827.pdf ／ https://www.maff.go.jp/j/tokei/census/afc/2020/attach/xls/index-6.xlsx
"""
import json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = 'https://www.soumu.go.jp/main_content/001001827.pdf'
XLS = 'https://www.maff.go.jp/j/tokei/census/afc/2020/attach/xls/index-6.xlsx'
PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県',
         '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
         '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県',
         '鹿児島県', '沖縄県']


def norm(s):
    """表記ゆれ（ケ・ヶ・ヵ、空白）をそろえる。"""
    return re.sub(r'\s+', '', s).replace('ヶ', 'ケ').replace('ヵ', 'ケ').replace('ﾉ', 'ノ')


def get(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        open(path, 'wb').write(urllib.request.urlopen(req, timeout=300).read())


def parse_jouyo(txt):
    """2段組の行から (都道府県, 市区町村, 9月期, 3月期, 合計) を全部取り出す。市区町村別は '市区町村別' の見出し以降。"""
    i = txt.index('譲与額（市区町村別）')
    pat = re.compile(r'(' + '|'.join(PREFS) + r')\s+(\S+?)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)')
    out = {}
    for line in txt[i:].splitlines():
        for m in pat.finditer(line):
            a, b, c = (int(x.replace(',', '')) for x in m.groups()[2:])
            out[(m.group(1), norm(m.group(2)))] = {'pref': m.group(1), 'name': m.group(2), 'sep': a, 'mar': b, 'total': c}
    return out


def main(work):
    os.makedirs(work, exist_ok=True)
    get(PDF, os.path.join(work, 'jouyo_r6.pdf'))
    txt = subprocess.run(['pdftotext', '-layout', os.path.join(work, 'jouyo_r6.pdf'), '-'], capture_output=True, text=True, check=True).stdout
    j = parse_jouyo(txt)
    rows = sorted(j.values(), key=lambda r: (PREFS.index(r['pref']), r['name']))
    json.dump({'unit': '千円', 'src': PDF, 'rows': rows}, open(os.path.join(HERE, 'jouyo_r6.json'), 'w'), ensure_ascii=False, indent=0)
    print('譲与額 市区町村', len(rows), '合計(千円)', sum(r['total'] for r in rows))
    get(XLS, os.path.join(work, 'census.xlsx'))
    import openpyxl
    ws = openpyxl.load_workbook(os.path.join(work, 'census.xlsx'), data_only=True).active
    cs = {}
    for r in ws.iter_rows(min_row=10, values_only=True):
        if r[2] and r[2] != '000' and r[5] and isinstance(r[6], (int, float)):
            cs[r[0] + r[2]] = {'name': r[5], 'ha': r[6], 'forest_rate': r[7]}
    json.dump({'unit': 'ha', 'src': XLS, 'rows': cs}, open(os.path.join(HERE, 'census2020_private.json'), 'w'), ensure_ascii=False)
    print('センサス 市区町村', len(cs), '私有林人工林合計 ha', sum(v['ha'] for v in cs.values()))


if __name__ == '__main__':
    main(sys.argv[1])
