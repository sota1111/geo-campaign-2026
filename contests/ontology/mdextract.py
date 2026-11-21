"""Markdown から事実を取り出す関数群（読むだけ。推測しない）。

取り出せなかったものは None / 空で返し、呼び出し側が「未抽出」として残す。
"""
import re

SECTION_RE = re.compile(r"(出典|データ|ライセンス)")


def split_row(line: str):
    line = line.strip()
    if not (line.startswith("|") and line.endswith("|")):
        return None
    cells, cur, esc = [], "", False
    for ch in line[1:-1]:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == "|":
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
    cells.append(cur.strip())
    return cells


def strip_md(s: str) -> str:
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    s = s.replace("**", "").replace("`", "")
    return s.strip()


def tables_in_sections(text: str, heading_re=SECTION_RE):
    """見出し（## / ###）が heading_re に合う節の表を返す。

    戻り値: [{heading, line, header[], rows:[{line, cells[]}]}]
    """
    lines = text.split("\n")
    out, sect, i = [], None, 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^(#{2,4})\s+(.*)", ln)
        if m:
            sect = (m.group(2), i + 1) if heading_re.search(m.group(2)) else None
            i += 1
            continue
        if sect and ln.strip().startswith("|"):
            header = split_row(ln)
            if header and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
                rows, j = [], i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    cells = split_row(lines[j])
                    if cells:
                        rows.append({"line": j + 1, "cells": cells})
                    j += 1
                out.append({"heading": sect[0], "line": sect[1], "header": header, "rows": rows})
                i = j
                continue
        i += 1
    return out


def dataset_rows(text: str):
    """README の出典表から (名前, 出典, ライセンス・利用条件, 行番号, 節名) を返す。

    ライセンス列（見出しに「ライセンス」「利用条件」「許諾」）がある表だけ対象。
    """
    res = []
    for t in tables_in_sections(text):
        h = [strip_md(x) for x in t["header"]]
        lic = next((k for k, x in enumerate(h) if re.search("ライセンス|利用条件|許諾|条件", x)), None)
        if lic is None:
            continue
        src = next((k for k, x in enumerate(h) if re.search("出典|提供", x)), None)
        for r in t["rows"]:
            c = r["cells"]
            if len(c) <= lic:
                continue
            name = strip_md(c[0])
            if not name:
                continue
            res.append(
                {
                    "name": name,
                    "source": strip_md(c[src]) if src is not None and len(c) > src else None,
                    "license": strip_md(c[lic]) or None,
                    "line": r["line"],
                    "section": t["heading"],
                }
            )
    return res


def h1(text: str):
    m = re.search(r"^#\s+(.+)$", text, re.M)
    return m.group(1).strip() if m else None


def placeholders(text: str, pattern):
    """未記入の穴（例: 【本人加筆…】）の (行番号, 先頭40字) 一覧。"""
    out = []
    for n, ln in enumerate(text.split("\n"), 1):
        for m in re.finditer(pattern, ln):
            out.append((n, ln[m.start() : m.start() + 40]))
    return out
