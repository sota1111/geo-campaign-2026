"""国交省 02.xlsx（道路陥没発生箇所の詳細）の探索。読むだけ。

使い方: python3 -I tools/explore_mlit02.py <02.xlsx>
"""
import sys
import os
import re
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlsx_read  # noqa: E402


def clean(s):
    """セルは『漢字＋カタカナのふりがな』が連結されている。ふりがなを落とす。"""
    return re.sub(r'[ァ-ヶー・]{3,}$', '', (s or '').strip())


def main(path):
    d = xlsx_read.read(path)
    for n, rows in d.items():
        city = 'A' in rows[1] and ('市町村' in n or '直轄' in n)
        adm = 'A' if ('市町村' in n or '直轄' in n) else 'B'
        key = 'C' if ('市町村' in n or '直轄' in n) else 'D'
        data = [r for r in rows if key in r and r.get(key) not in ('地名チメイ',) and clean(r.get(key))]
        osaka = [r for r in data if clean(r.get(key)).startswith('大阪府')]
        print(n, 'rows', len(rows), 'data', len(data), 'osaka(addr)', len(osaka))
        toy = [r for r in data if '豊中' in clean(r.get(key)) or '豊中' in r.get(adm, '')]
        print('  toyonaka', len(toy))
        for r in toy:
            print('   ', {k: clean(v) for k, v in r.items()})
        c = collections.Counter(clean(r.get(adm)) for r in osaka)
        print('  osaka by admin', c.most_common(80))
        # 地名が「地先」で終わる割合・番地まで出るか
        chome = [clean(r.get(key)) for r in data if re.search(r'[0-9０-９一二三四五六七八九十]+丁目|[0-9０-９]+番', clean(r.get(key)))]
        print('  with chome/banchi', len(chome), chome[:5])


if __name__ == '__main__':
    main(sys.argv[1])
