"""XLSX を標準ライブラリだけで読む最小の読み取り器（openpyxl 不要）。

使い方: python3 -I tools/xlsx_read.py <file.xlsx> [表示行数]
読むだけ。数式は評価しない（キャッシュ値を読む）。
"""
import sys
import zipfile
import re
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M = '{%s}' % NS['m']


def read(path):
    """{シート名: [ {列記号: 文字列}, ... ]} を返す。"""
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter(M + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.find('m:sheets', NS)]
    out = {}
    for i, n in enumerate(names, 1):
        rows = []
        for r in ET.fromstring(z.read('xl/worksheets/sheet%d.xml' % i)).iter(M + 'row'):
            row = {}
            for c in r.findall('m:c', NS):
                col = re.match(r'[A-Z]+', c.get('r')).group()
                v = c.find('m:v', NS)
                t = c.get('t')
                if t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(M + 't'))
                elif v is None:
                    continue
                elif t == 's':
                    val = ss[int(v.text)]
                else:
                    val = v.text
                row[col] = val
            rows.append(row)
        out[n] = rows
    return out


if __name__ == '__main__':
    d = read(sys.argv[1])
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    for n, rows in d.items():
        print('SHEET', n, len(rows))
        for r in rows[:k]:
            print(r)
