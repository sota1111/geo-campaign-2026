"""AED の「利用可能曜日・開始時間・終了時間」と自由記述の利用可能時間を、共通形式に正規化する。

共通形式（parse_availability の戻り値）:
  {"kind": "24h" | "timed" | "unknown",
   "windows": [[曜日, 開始分, 終了分], ...],   # 曜日 0=月 ... 6=日。分は 0..1440。終了は含まない
   "reason": 不明のときの理由コード（"empty" "facility" "no_time" "no_day" "garbled" "bad_range"）}

解釈できない値は「不明」(kind="unknown") として扱い、推測で埋めない。
方針:
  - 「施設の開館時間」「営業時間」のように時刻が書かれていないものは reason="facility" の不明。
  - 曜日が空で時刻だけある場合は不明（reason="no_day"）。毎日と決めつけない。
  - 日をまたぐ範囲（18:00〜翌6:00）は 2 つの窓に分ける。
  - 祝日・年末年始・特記事項は反映しない（画面と README で限界として明示）。ただし曜日欄の「祝」だけは無視する。
"""
import re
import unicodedata

DAYCH = "月火水木金土日"
WEEKDAYS = [0, 1, 2, 3, 4]

_FACILITY = re.compile(r"開館時間|開庁時間|営業時間|開店時間|診療時間|勤務時間|施設の?(?:利用|開放|開館|開所)?時間|受付時間|開園時間|開場時間|開放時間|利用時間内|窓口時間|公開時間|開所時間")
_ALL_DAY = re.compile(r"24\s*時間|24\s*h(?:ours?|r)?\b|終日|常時|24時間365日|24-?7|年中無休|通年24|一日中|昼夜")
_SEP = r"(?:~|〜|～|-|−|‐|–|—|ー|から|より)"
_TOK = (r"(?P<ap{n}>午前|午後)?\s*(?P<h{n}>\d{{1,2}})\s*"
        r"(?:[:](?P<m{n}>\d{{1,2}})|時(?:\s*(?P<mm{n}>\d{{1,2}})\s*分?|\s*(?P<half{n}>半))?)")
_RANGE = re.compile(_TOK.format(n=1) + r"\s*" + _SEP + r"\s*(?:翌日?\s*)?" + _TOK.format(n=2))


def _norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("　", " ").strip()


def parse_days(s):
    """曜日欄 → 曜日番号のリスト（0=月）。解釈できなければ None。空は None。"""
    s = _norm(s)
    if not s:
        return None
    s = s.replace("祝日", "").replace("祝", "").replace("曜日", "").replace("曜", "")
    s = re.sub(r"[\s、,・/／]+", "", s)
    if not s:
        return None
    if re.fullmatch(r"(毎日|全日|年中無休|無休|毎週)", s):
        return list(range(7))
    if s == "平日":
        return list(WEEKDAYS)
    if s in ("土日", "休日", "土日休", "週末"):
        return [5, 6]
    m = re.fullmatch(r"([月火水木金土日])(?:~|〜|-|ー|から)([月火水木金土日])", s)
    if m:
        a, b = DAYCH.index(m.group(1)), DAYCH.index(m.group(2))
        if a <= b:
            return list(range(a, b + 1))
        return list(range(a, 7)) + list(range(0, b + 1))
    if all(c in DAYCH for c in s):
        return sorted({DAYCH.index(c) for c in s})
    return None


def _add_range(windows, days, a, b):
    """分単位の範囲を窓に追加。b<=a は翌日にまたがる。不正な値は False。"""
    if a < 0 or a > 1440 or b < 0 or b > 2880:
        return False
    if a == b:
        return False
    for d in days:
        if b > a:
            if b <= 1440:
                windows.append([d, a, b])
            else:
                windows.append([d, a, 1440])
                windows.append([(d + 1) % 7, 0, b - 1440])
        else:  # 夜をまたぐ（終了が0時ちょうどなら、その日の24時まで）
            windows.append([d, a, 1440])
            if b > 0:
                windows.append([(d + 1) % 7, 0, b])
    return True


def _merge(windows):
    out = []
    for d in range(7):
        iv = sorted((s, e) for dd, s, e in windows if dd == d)
        cur = None
        for s, e in iv:
            if cur and s <= cur[1]:
                cur[1] = max(cur[1], e)
            else:
                if cur:
                    out.append([d, cur[0], cur[1]])
                cur = [s, e]
        if cur:
            out.append([d, cur[0], cur[1]])
    return out


def _result(windows, reason=None):
    if not windows:
        return {"kind": "unknown", "windows": [], "reason": reason or "garbled"}
    w = _merge(windows)
    if all(any(d == dd and s == 0 and e == 1440 for dd, s, e in w) for d in range(7)):
        return {"kind": "24h", "windows": [[d, 0, 1440] for d in range(7)], "reason": None}
    return {"kind": "timed", "windows": w, "reason": None}


def _minutes(m, n):
    hh = int(m.group("h%d" % n))
    mm = int(m.group("m%d" % n) or m.group("mm%d" % n) or 0)
    if m.group("half%d" % n):
        mm = 30
    ap = m.group("ap%d" % n)
    if ap == "午後" and hh < 12:
        hh += 12
    return hh * 60 + mm


def _find_ranges(text):
    out = []
    for m in _RANGE.finditer(text):
        a, b = _minutes(m, 1), _minutes(m, 2)
        if m.group("ap2") == "午後" and m.group("ap1") is None and a < 12 * 60 and b > a:
            pass  # 「9時～午後5時」: 開始は午前のまま
        out.append((m.start(), m.end(), a, b))
    return out


_CONDITION = re.compile(r"学校使用時|使用時のみ|利用時のみ|開設時|時間内|職員在室|有人|開催時|イベント時|貸出時|施設利用時")
_EXCL = re.compile(r"((?:[月火水木金土日]曜日?[、・及びと]*)+)\s*(?:は|を|も)?\s*(?:除く|以外|休み|休館|休業)")
_CLOSED = re.compile(r"(?:休館日|休業日|定休日|休診日|休館)\s*[（(:：]*\s*([^）)]*)")


def _excluded_days(t):
    ex = set()
    for m in re.finditer(r"除く|除き|以外", t):
        ctx = t[max(0, m.start() - 40):m.start()]
        ex |= {DAYCH.index(c) for c in re.findall(r"([月火水木金土日])曜", ctx)}
    for m in _CLOSED.finditer(t):
        ex |= {DAYCH.index(c) for c in re.findall(r"([月火水木金土日])曜", m.group(1))}
    return ex


def parse_freetext(text):
    """自由記述（例:「平日9:00-17:00、土日10:00-16:00」「24時間使用可能」「施設の開館時間」）を解釈する。"""
    t = _norm(text)
    if not t:
        return {"kind": "unknown", "windows": [], "reason": "empty"}
    # 時刻の範囲があれば優先（「24時間」より具体）。なければ 24 時間表記
    ranges = _find_ranges(t)
    if not ranges:
        if _ALL_DAY.search(t) and not re.search(r"24時間\s*以外|24時間\s*不可|利用不可|使用不可", t):
            if _CONDITION.search(t) or _FACILITY.search(t):
                return {"kind": "unknown", "windows": [], "reason": "conditional"}
            ex = _excluded_days(t)
            days = [d for d in range(7) if d not in ex]
            if not days:
                return {"kind": "unknown", "windows": [], "reason": "garbled"}
            return _result([[d, 0, 1440] for d in days])
        if _FACILITY.search(t):
            return {"kind": "unknown", "windows": [], "reason": "facility"}
        return {"kind": "unknown", "windows": [], "reason": "no_time" if re.search(r"\d", t) else "garbled"}
    windows = []
    excl = _excluded_days(t)
    # 各範囲の直前の文字列から曜日指定を探す。見つからなければ直前の指定を引き継ぐ
    last_days = None
    prev_end = 0
    for st, en, a, b in ranges:
        seg = t[prev_end:st]
        days = _days_in_segment(seg)
        if days is None:
            days = last_days
        if days is None and excl:
            days = list(range(7))  # 休館日だけが書かれている: それ以外の曜日に使えるとみなす
        if days is None:
            # 曜日の記載がない: 毎日とは決めつけない
            return {"kind": "unknown", "windows": [], "reason": "no_day"}
        last_days = days
        use = [d for d in days if d not in excl] if excl and len(ranges) == 1 else list(days)
        if not use:
            return {"kind": "unknown", "windows": [], "reason": "garbled"}
        if (a == 0 and b in (1440, 1439)) or (a == 0 and b == 0):
            _add_range(windows, use, 0, 1440)
        elif not _add_range(windows, use, a, b):
            return {"kind": "unknown", "windows": [], "reason": "bad_range"}
        prev_end = en
    return _result(windows)


_SEG_DAYS = [
    (re.compile(r"毎日|全日|年中無休"), list(range(7))),
    (re.compile(r"平日"), WEEKDAYS),
    (re.compile(r"土日祝?|休日|週末"), [5, 6]),
]


def _days_in_segment(seg):
    seg = seg.strip()
    if not seg:
        return None
    # 区切り後の最後の節だけを見る
    seg = re.split(r"[、,。;；\n/／]", seg)[-1] if re.search(r"[、,。;；\n/／]", seg) else seg
    m = re.search(r"([月火水木金土日])\s*(?:曜日?)?\s*(?:~|〜|-|ー|から)\s*([月火水木金土日])", seg)
    if m:
        return parse_days(m.group(1) + "-" + m.group(2))
    for rx, days in _SEG_DAYS:
        if rx.search(seg):
            return list(days)
    m = re.search(r"([月火水木金土日](?:[・、]?[月火水木金土日])*)\s*(?:曜日?)?", seg)
    if m and re.search(r"[月火水木金土日]", seg[-6:]):
        return parse_days(m.group(1))
    return None


def _parse_strict(days="", start="", end="", free=""):
    """標準形式の3項目（曜日・開始・終了）を優先し、足りなければ自由記述を解釈する（推測しない版）。"""
    d, s, e = _norm(days), _norm(start), _norm(end)
    if s or e:
        ms = re.fullmatch(r"(\d{1,2})[:：](\d{2})(?::\d{2})?", s) if s else None
        me = re.fullmatch(r"(\d{1,2})[:：](\d{2})(?::\d{2})?", e) if e else None
        if not (ms and me):
            # 「9時」「午前9時」など。自由記述として解釈できるか試す
            r = parse_freetext(" ".join(x for x in (d, s + "〜" + e if s and e else s or e) if x))
            return r
        days_l = parse_days(d)
        a = int(ms.group(1)) * 60 + int(ms.group(2))
        b = int(me.group(1)) * 60 + int(me.group(2))
        if days_l is None:
            if d:
                r = parse_freetext(d)
                return r if r["kind"] != "unknown" else {"kind": "unknown", "windows": [], "reason": "garbled"}
            return {"kind": "unknown", "windows": [], "reason": "no_day"}
        if (a == 0 and b in (1439, 1440)) or (a == 0 and b == 0):
            w = []
            _add_range(w, days_l, 0, 1440)
            return _result(w)
        w = []
        if not _add_range(w, days_l, a, b):
            return {"kind": "unknown", "windows": [], "reason": "bad_range"}
        return _result(w)
    # 開始・終了が空
    if d:
        r = parse_freetext(d)
        if r["kind"] != "unknown":
            return r
        if parse_days(d) is not None:
            return {"kind": "unknown", "windows": [], "reason": "no_time"}
    if free:
        return parse_freetext(free)
    return {"kind": "unknown", "windows": [], "reason": "empty"}


def parse_availability(days="", start="", end="", free="", assume_everyday=False):
    """利用可能時間を共通形式にする。戻り値に "assumed"（曜日の記載がないため毎日とみなしたか）を足す。

    assume_everyday=False（既定）: 曜日が書かれていない時刻だけの記載は不明（reason="no_day"）。
    自治体標準の定義書は、曜日が定まっていない場合は空欄とし特記事項に理由を書く、としており、
    空欄を「毎日」と読む根拠がないため。True にすると毎日とみなし、assumed=True を付ける（画面で切り替える）。
    """
    r = _parse_strict(days, start, end, free)
    r["assumed"] = False
    if assume_everyday and r["kind"] == "unknown" and r["reason"] == "no_day":
        s, e = _norm(start), _norm(end)
        if s or e:
            r2 = _parse_strict("毎日", start, end, free)
        else:
            d, f = _norm(days), _norm(free)
            r2 = _parse_strict("", "", "", "毎日 " + (d or f))
        if r2["kind"] != "unknown":
            r2["assumed"] = True
            return r2
    return r


def is_usable(windows, day, minute):
    """day=0..6（月..日）、minute=0..1439 の時刻に使えるか。"""
    return any(d == day and s <= minute < e for d, s, e in windows)
