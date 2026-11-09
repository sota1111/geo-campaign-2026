#!/usr/bin/env python3
"""様式1 (Award_Proposal_Form.docx) に提案原稿(.md)を記入して .docx を出力する。

python3 contests/satellite-2026/tools/fill_form.py proposal-A
  -> submission/proposal-A.md を読み、submission/proposal-A.docx を作る。

標準ライブラリのみ(zipfile + 文字列置換)。python-docx / lxml 不要。
- 青字の注意書きを削除し、本文(MSゴシック11pt)で置き換える
- 応募テーマの該当チェックボックスを☑にする
- 申請者欄は【総司令官記入】で埋める(個人情報は書かない)
- md の `[図] a → b → c` 行は、概要欄の先頭に流れ図(1行の表)として入れる
"""
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

BASE = Path(__file__).resolve().parent.parent
TEMPLATE = BASE / "template" / "Award_Proposal_Form.docx"
SUB = BASE / "submission"

FONT = ('<w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" '
        'w:cs="MS Gothic" w:hint="eastAsia"/>')
NOTE = "【総司令官記入】"
THEME_KEYS = {"協賛企業テーマ": "協賛企業", "共通テーマ1": "共通テーマ１", "共通テーマ2": "共通テーマ２"}
P_RE = re.compile(r"<w:p [^>]*>(?:(?!</w:p>).)*</w:p>", re.S)
TC_RE = re.compile(r"<w:tc>.*?</w:tc>", re.S)


def run(text, sz=22, bold=False):
    b = "<w:b/><w:bCs/>" if bold else ""
    return (f'<w:r><w:rPr>{FONT}{b}<w:color w:val="000000"/><w:sz w:val="{sz}"/>'
            f'<w:szCs w:val="{sz}"/></w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>')


def para(text, sz=22, jc="left", first_indent=True, bold=False):
    ind = '<w:ind w:left="36" w:firstLine="220"/>' if first_indent else '<w:ind w:left="36"/>'
    return (f'<w:p><w:pPr><w:widowControl/>{ind}<w:jc w:val="{jc}"/><w:rPr>{FONT}'
            f'<w:sz w:val="{sz}"/></w:rPr></w:pPr>{run(text, sz, bold) if text else ""}</w:p>')


def figure(text):
    steps = [s.strip() for s in text.split("→")]
    wbox = (9100 - 380 * (len(steps) - 1)) // len(steps)
    cells, grid = [], []
    bd = "".join(f'<w:{s} w:val="single" w:sz="6" w:space="0" w:color="2E75B5"/>'
                 for s in ("top", "left", "bottom", "right"))
    for i, s in enumerate(steps):
        grid.append(f'<w:gridCol w:w="{wbox}"/>')
        cells.append(f'<w:tc><w:tcPr><w:tcW w:w="{wbox}" w:type="dxa"/>'
                     f'<w:tcBorders>{bd}</w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="EAF1FA"/>'
                     f'<w:vAlign w:val="center"/></w:tcPr>{para(s, 18, "center", False)}</w:tc>')
        if i < len(steps) - 1:
            grid.append('<w:gridCol w:w="380"/>')
            cells.append('<w:tc><w:tcPr><w:tcW w:w="380" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>'
                         f'{para("→", 22, "center", False, True)}</w:tc>')
    return ('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/>'
            '<w:tblLayout w:type="fixed"/></w:tblPr>'
            f'<w:tblGrid>{"".join(grid)}</w:tblGrid><w:tr>{"".join(cells)}</w:tr></w:tbl>'
            + para("", 8, first_indent=False))


def parse_md(path):
    t = Path(path).read_text(encoding="utf-8")
    secs = {}
    for s in re.split(r"\n## ", t)[1:]:
        head, _, body = s.partition("\n")
        secs[head.strip()] = body.strip()
    return secs


def set_cell(tc, new_inner):
    m = re.match(r"(<w:tc>(?:<w:tcPr>.*?</w:tcPr>)?)(.*)(</w:tc>)$", tc, re.S)
    return m.group(1) + new_inner + m.group(3)


def spans(rx, xml):
    return [(m.start(), m.end()) for m in rx.finditer(xml)]


def text_of(x):
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", x))


def fill(md_path, out_path):
    secs = parse_md(md_path)
    with zipfile.ZipFile(TEMPLATE) as z:
        items = {n: z.read(n) for n in z.namelist()}
        infos = {i.filename: i for i in z.infolist()}
    xml = items["word/document.xml"].decode("utf-8")

    # 1. テーマのチェックボックス
    themes = [x.strip() for x in secs["応募テーマ"].split(",")]
    for name in themes:
        key = THEME_KEYS[name]
        for m in P_RE.finditer(xml):
            p = m.group(0)
            if "☐" in p and key in text_of(p):
                p2 = p.replace('<w14:checked w14:val="0"/>', '<w14:checked w14:val="1"/>')
                p2 = re.sub(r"<w:sdtContent>.*?</w:sdtContent>",
                            '<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:eastAsia="MS Gothic" '
                            'w:hAnsi="Wingdings" w:cs="MS Gothic" w:hint="eastAsia"/><w:sz w:val="22"/></w:rPr>'
                            '<w:t>þ</w:t></w:r></w:sdtContent>', p2, flags=re.S)
                xml = xml.replace(p, p2, 1)
                break
        else:
            raise SystemExit(f"チェックボックスが見つからない: {name}")

    # 2. 提案名称
    for a, b in spans(TC_RE, xml):
        tc = xml[a:b]
        if text_of(tc).startswith("※ご提案の内容を端的に表した名称"):
            xml = xml[:a] + set_cell(tc, para(secs["提案名称"], first_indent=False)) + xml[b:]
            break
    else:
        raise SystemExit("提案名称欄が見つからない")

    # 3. 申請者(代表者)欄: ラベルの次のセルを【総司令官記入】にする
    start = xml.index("申請者（代表者）")
    end = xml.index("グループで申請される場合は")
    region = xml[start:end]
    cs = spans(TC_RE, region)
    labels = ["所属先", "代表者氏名", "ふりがな", "部署名・役職", "所属所在地", "電話番号（直通）", "E-mail"]
    new_region, pos, filled = "", 0, 0
    for i, (a, b) in enumerate(cs):
        lab = text_of(region[a:b])
        for L in labels:
            if lab.startswith(L) and i + 1 < len(cs):
                a2, b2 = cs[i + 1]
                inner = (para("〒" + NOTE, first_indent=False) + para(NOTE, first_indent=False)
                         if L == "所属所在地" else para(NOTE, first_indent=False))
                new_region += region[pos:a2] + set_cell(region[a2:b2], inner)
                pos = b2
                filled += 1
                break
    assert filled == len(labels), f"申請者欄 {filled}/{len(labels)}"
    xml = xml[:start] + new_region + region[pos:] + xml[end:]

    # 4. グループ用の青字注意書き(申請者欄の下の説明と参加者表内)を削除
    def strip_blue(m):
        p = m.group(0)
        t = text_of(p)
        if "所属している法人名" in t or "グループで申請される場合は" in t:
            return re.sub(r"<w:r[ >].*</w:r>", "", p, flags=re.S)
        return p
    xml = P_RE.sub(strip_blue, xml)

    # 5. 本文5項目: 青字の注意書きを含むセルを本文に置換
    heads = ["1. 提案の概要", "2. 募集テーマ合致性", "3. 事業スコープ・衛星データ活用の妥当性",
             "4. 事業の実現性・収益性", "5. 実用化による社会発展性"]
    body_from = xml.index("提案の概要")
    done, pos = 0, body_from
    out = xml[:body_from]
    for a, b in spans(TC_RE, xml[body_from:]):
        a += body_from
        b += body_from
        tc = xml[a:b]
        if "字程度で記載してください" in text_of(tc) and done < 5:
            inner = ""
            for line in secs[heads[done]].split("\n"):
                line = line.strip()
                if not line:
                    continue
                inner += figure(line[3:].strip()) if line.startswith("[図]") else para(line)
            out += xml[pos:a] + set_cell(tc, inner)
            pos = b
            done += 1
    assert done == 5, f"本文セルが{done}個しか見つからない"
    xml = out + xml[pos:]

    items["word/document.xml"] = xml.encode("utf-8")
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zo:
        for n, data in items.items():
            zo.writestr(infos[n], data, compress_type=zipfile.ZIP_DEFLATED)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    name = sys.argv[1]
    fill(SUB / f"{name}.md", SUB / f"{name}.docx")
    print(f"生成: {SUB / (name + '.docx')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
