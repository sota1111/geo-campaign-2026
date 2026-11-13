"""標準ライブラリだけの最小の xlsx 読み取り（セルの値を文字列で返す）。openpyxl 不要。"""
import re
import xml.etree.ElementTree as ET
import zipfile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _col(ref: str) -> int:
    n = 0
    for c in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(c) - 64
    return n - 1


def read_sheet(path, sheet: int = 1):
    """sheet 番号（1始まり）の全行を list[list[str]] で返す。空セルは ''。"""
    z = zipfile.ZipFile(path)
    shared = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
        shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    rows = []
    for _ev, el in ET.iterparse(z.open(f"xl/worksheets/sheet{sheet}.xml")):
        if el.tag != NS + "row":
            continue
        r = {}
        for c in el.iter(NS + "c"):
            v = c.find(NS + "v")
            if v is None:
                t = c.find(NS + "is")
                if t is not None:
                    r[_col(c.get("r"))] = "".join(x.text or "" for x in t.iter(NS + "t"))
                continue
            r[_col(c.get("r"))] = shared[int(v.text)] if c.get("t") == "s" else v.text
        if r:
            rows.append([r.get(i, "") for i in range(max(r) + 1)])
        el.clear()
    return rows
