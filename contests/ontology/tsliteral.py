"""TypeScript の配列/オブジェクトリテラルを Python の値に読む最小のパーサ。

contests/dashboard/src/apps/*.ts の `export const NAME: T[] = [ ... ]` を、
Node を使わずに読むためのもの。対応: {} [] 文字列('...' "..." `...`)、数値、true/false/null、
識別子（そのまま文字列 "$ident" として返す）、コメント、末尾カンマ、文字列の + 連結。
"""
import re


class TSLiteralError(ValueError):
    pass


def _skip_string(s: str, i: int) -> int:
    q = s[i]
    i += 1
    while i < len(s):
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == q:
            return i + 1
        i += 1
    raise TSLiteralError("文字列が閉じない")


def extract_array(src: str, name: str) -> str:
    """`export const <name>...= [` から対応する `]` までの本文（括弧を含む）を返す。"""
    m = re.search(r"export const " + re.escape(name) + r"\b[^=]*=\s*\[", src)
    if not m:
        raise TSLiteralError(f"{name} が見つからない")
    start = m.end() - 1
    depth, i, n = 0, start, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            i = _skip_string(src, i)
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            i = src.index("*/", i) + 2
            continue
        if c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    raise TSLiteralError("括弧が閉じない")


class _P:
    NUM = re.compile(r"-?\d+(\.\d+)?")
    IDENT = re.compile(r"[A-Za-z_$][\w$.]*")
    KEY = re.compile(r"[A-Za-z_$][\w$]*")

    def __init__(self, s):
        self.s, self.i = s, 0

    def ws(self):
        s = self.s
        while self.i < len(s):
            if s[self.i].isspace():
                self.i += 1
            elif s.startswith("//", self.i):
                j = s.find("\n", self.i)
                self.i = len(s) if j < 0 else j
            elif s.startswith("/*", self.i):
                self.i = s.index("*/", self.i) + 2
            else:
                break

    def value(self):
        self.ws()
        v = self._atom()
        self.ws()
        while self.s.startswith("+", self.i) and isinstance(v, str):
            self.i += 1
            self.ws()
            v += self._atom()
            self.ws()
        return v

    def _atom(self):
        s, c = self.s, self.s[self.i]
        if c == "{":
            return self._obj()
        if c == "[":
            return self._arr()
        if c in "'\"`":
            return self._str()
        m = self.NUM.match(s, self.i)
        if m:
            self.i = m.end()
            return float(m.group()) if "." in m.group() else int(m.group())
        m = self.IDENT.match(s, self.i)
        if m:
            self.i = m.end()
            w = m.group()
            return {"true": True, "false": False, "null": None}.get(w, "$" + w)
        raise TSLiteralError(f"想定外の文字 {c!r} 位置 {self.i}")

    def _str(self):
        s, q = self.s, self.s[self.i]
        self.i += 1
        out = []
        while s[self.i] != q:
            if s[self.i] == "\\":
                nx = s[self.i + 1]
                out.append({"n": "\n", "t": "\t"}.get(nx, nx))
                self.i += 2
            else:
                out.append(s[self.i])
                self.i += 1
        self.i += 1
        return "".join(out)

    def _arr(self):
        self.i += 1
        out = []
        while True:
            self.ws()
            if self.s[self.i] == "]":
                self.i += 1
                return out
            out.append(self.value())
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1

    def _obj(self):
        self.i += 1
        out = {}
        while True:
            self.ws()
            if self.s[self.i] == "}":
                self.i += 1
                return out
            if self.s[self.i] in "'\"":
                k = self._str()
            else:
                m = self.KEY.match(self.s, self.i)
                if not m:
                    raise TSLiteralError(f"キーが読めない 位置 {self.i}")
                k, self.i = m.group(), m.end()
            self.ws()
            if self.s[self.i] != ":":
                raise TSLiteralError(f"':' がない（キー {k}）")
            self.i += 1
            out[k] = self.value()
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1


def parse_array(src: str, name: str):
    return _P(extract_array(src, name)).value()
