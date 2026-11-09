#!/usr/bin/env python3
"""提出 .docx を解凍し直して本文を抽出し、各項目の字数・体裁を検査する。

python3 contests/satellite-2026/tools/check_docx.py [proposal-A proposal-B ...]
検査: XMLが整形式／各項目450〜550字(図の中の文字は除外し別掲)／青字の注意書きの残存／
      テーマ☑／本文のフォントがMSゴシック11pt／【総司令官記入】【本人加筆】の残数。
字数は改行を除く全文字(空白・句読点を含む)。範囲外があれば exit 1。
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
q = lambda t: f"{{{W}}}{t}"
SUB = Path(__file__).resolve().parent.parent / "submission"
LO, HI = 450, 550
HEADS = ["1.提案の概要", "2.募集テーマ合致性", "3.事業スコープ・衛星データ活用の妥当性",
         "4.事業の実現性・収益性", "5.実用化による社会発展性"]
BLUE = {"2E75B5", "2E74B5", "5B9BD5"}


def ptext(p):
    return "".join(t.text or "" for t in p.iter(q("t")))


def direct_paragraphs(tc):
    return [c for c in tc if c.tag == q("p")]


def main():
    names = sys.argv[1:] or ["proposal-A", "proposal-B"]
    bad = False
    for name in names:
        path = SUB / f"{name}.docx"
        with zipfile.ZipFile(path) as z:
            root = ET.fromstring(z.read("word/document.xml"))  # 整形式でなければここで例外
        body = root.find(q("body"))
        print(f"\n== {path.name} ==")

        # 本文5項目
        tables = [t for t in body if t.tag == q("tbl")]
        found = {}
        for tbl in tables:
            first = ptext(next(tbl.iter(q("p")))).replace(" ", "").replace("　", "")
            for h in HEADS:
                if first == h:
                    rows = tbl.findall(q("tr"))
                    tc = rows[1].find(q("tc"))
                    body_txt = "".join(ptext(p) for p in direct_paragraphs(tc))
                    fig = "".join(ptext(p) for t in tc.findall(q("tbl")) for p in t.iter(q("p")))
                    found[h] = (len(body_txt), len(fig))
        print("| 項目 | 字数 | 図内文字 | 判定 |\n|---|---|---|---|")
        for h in HEADS:
            if h not in found:
                print(f"| {h} | - | - | 見つからない |")
                bad = True
                continue
            n, f = found[h]
            ok = LO <= n <= HI
            bad |= not ok
            print(f"| {h} | {n} | {f} | {'OK' if ok else 'NG(' + str(LO) + '〜' + str(HI) + ')'} |")

        # 青字の注意書きの残存(見出し帯の塗りではなく文字色)
        left = []
        for p in root.iter(q("p")):
            for r in p.iter(q("r")):
                c = r.find(f"{q('rPr')}/{q('color')}")
                if c is not None and c.get(q("val")) in BLUE and "".join(t.text or "" for t in r.iter(q("t"))).strip():
                    left.append(ptext(p)[:30])
                    break
        print(f"青字の残存: {len(left)}件 {left[:3]}")
        bad |= bool(left)

        # チェックボックス
        sdts = []
        for sdt in root.iter(q("sdt")):
            ck = sdt.find(f".//{{{W14}}}checked")
            if ck is not None:
                label = "".join(ptext(p) for p in [sdt.getparent()] ) if False else ""
                sdts.append(ck.get(f"{{{W14}}}val"))
        body_text = "".join(t.text or "" for t in root.iter(q("t")))
        print(f"チェックボックス(順に協賛/共通1/共通2想定): {sdts}")
        print(f"【総司令官記入】: {body_text.count('【総司令官記入】')}箇所 / 【本人加筆】: {body_text.count('【本人加筆')}箇所")

        # フォント: 本文セル内の run が MS Gothic / 11pt か
        wrong = 0
        for tbl in tables:
            first = ptext(next(tbl.iter(q("p")))).replace(" ", "")
            if first in HEADS:
                tc = tbl.findall(q("tr"))[1].find(q("tc"))
                for p in direct_paragraphs(tc):
                    for r in p.iter(q("r")):
                        f = r.find(f"{q('rPr')}/{q('rFonts')}")
                        s = r.find(f"{q('rPr')}/{q('sz')}")
                        if f is None or f.get(q("eastAsia")) != "MS Gothic" or s is None or s.get(q("val")) != "22":
                            wrong += 1
        print(f"本文のフォント不一致(MSゴシック11pt以外): {wrong}件")
        bad |= wrong > 0
    print("\n結果:", "NG" if bad else "OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
