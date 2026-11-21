#!/usr/bin/env python3
"""林野庁「スギ人工林伐採重点区域の設定について」（令和8年4月1日時点）のPDFから、関東1都6県の重点区域の市町村と面積を取り出して
tools/kanto_zone.json に書く。PDF は GET で取得する（ポリゴンは公開されておらず、表は市町村名の列挙のみ）。pdftotext（poppler）が必要。
出典: https://www.rinya.maff.go.jp/j/sin_riyou/kafun/attach/pdf/suishin-11.pdf
使い方: python3 -I tools/kanto_zone.py
"""
import json, os, re, subprocess, tempfile, unicodedata, urllib.request

URL = 'https://www.rinya.maff.go.jp/j/sin_riyou/kafun/attach/pdf/suishin-11.pdf'
HERE = os.path.dirname(os.path.abspath(__file__))
PREFS = ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']
ALLP = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] + PREFS + ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県']
# PDF の文字は部首（康熙部首など）の字形になっていることがある。NFKC で直らないものを直す。
RAD = dict(zip('⻑⻘⻄⿓⿅⿊⿂⿁⻤⻯⻨⻲⼀⼆戶', '長青西龍鹿黒魚鬼鬼馬麦亀一二戸'))


def main():
    with tempfile.TemporaryDirectory() as d:
        pdf = os.path.join(d, 's11.pdf')
        req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
        open(pdf, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        t = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    t = unicodedata.normalize('NFKC', t)
    blocks, cur = {}, None
    for ln in t.split('\n'):
        s = ln.strip()
        m = re.match(r'^(\S+?[都道府県])\s+(.*)$', s)
        if m and m.group(1) in ALLP:
            cur = m.group(1); blocks[cur] = [m.group(2)]
            continue
        if cur and s and not s.startswith('都道府県名') and not s.startswith('対象となる'):
            blocks[cur].append(s)
    munis, areas = {}, {}
    for p in PREFS:
        txt = re.sub(r'\s+', '', ''.join(blocks[p])).replace('人工林面積(ha)', '')
        for a, b in RAD.items():
            txt = txt.replace(a, b)
        areas[p] = int(re.findall(r'\d{1,3},\d{3}', txt)[0].replace(',', ''))
        txt = re.sub(r'\d{1,3},\d{3}', '', txt)
        munis[p] = [x for x in txt.split(',') if x]
    out = {'source': URL, 'asof': '令和8年4月1日時点', 'fetched': '2026-11-21', 'areas_ha': areas, 'munis': munis}
    json.dump(out, open(os.path.join(HERE, 'kanto_zone.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print({p: len(v) for p, v in munis.items()}, areas)


if __name__ == '__main__':
    main()
