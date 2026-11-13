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
  - 祝日・年末年始は反映しない（画面と README で限界として明示）。ただし曜日欄の「祝」だけは無視する。
  - 曜日は「月曜」「土日」「月～金」「平日」など曜日として書かれた形だけを読む。「開館日」の「日」、「4月～9月」の「月」は曜日ではない。
  - 「終日」だけでは 24 時間と読まない（開館中の意味でも使われるため）。「24時間」「常時」などが書かれたものだけを 24 時間とする。
  - 「休館」「除く」で除外された曜日は、除外ではなく使える曜日として読まない。除外される曜日が書かれていなければ不明。
  - 夏冬で時間が違う等（季節別）、複数の設置箇所の条件が混ざった記載は不明（reason="seasonal" "multi"）。
  - 町田市の「利用可能日時特記事項」は apply_special_note で曜日・時間に反映できるものだけ反映し、条件付きで読めないものは不明にする。
"""
import re
import unicodedata

DAYCH = "月火水木金土日"
WEEKDAYS = [0, 1, 2, 3, 4]

_FACILITY = re.compile(r"開館時間|開庁時間|営業時間|開店時間|診療時間|勤務時間|施設の?(?:利用|開放|開館|開所)?時間|受付時間|開園時間|開場時間|開放時間|利用時間内|窓口時間|公開時間|開所時間")
_SEP = r"(?:~|〜|～|-|−|‐|–|—|ー|から|より)"
_TOK = (r"(?P<ap{n}>午前|午後)?\s*(?P<h{n}>\d{{1,2}})\s*"
        r"(?:[:](?P<m{n}>\d{{1,2}})|時(?:\s*(?P<mm{n}>\d{{1,2}})\s*分?|\s*(?P<half{n}>半))?)")
_RANGE = re.compile(_TOK.format(n=1) + r"\s*" + _SEP + r"\s*(?:翌日?\s*)?" + _TOK.format(n=2))


def _norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    return s.replace("　", " ").strip()


def parse_days(s):
    """曜日欄 → 曜日番号のリスト（0=月）。解釈できなければ None。空は None。
    「土日休」「月曜休館」は休みの曜日が書かれているので、それ以外の曜日を返す。"""
    s = _norm(s)
    if not s:
        return None
    s = s.replace("祝日", "").replace("祝", "").replace("曜日", "").replace("曜", "")
    s = re.sub(r"[\s、,・/／]+", "", s)
    if not s:
        return None
    m = re.fullmatch(r"([月火水木金土日]+)(?:休館日?|休園日?|休業日?|休診日?|休み|休)", s)
    if m:
        closed = {DAYCH.index(c) for c in m.group(1)}
        rest = [d for d in range(7) if d not in closed]
        return rest or None
    if re.fullmatch(r"(毎日|全日|年中無休|無休|毎週)", s):
        return list(range(7))
    if s == "平日":
        return list(WEEKDAYS)
    if s in ("土日", "休日", "週末"):
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


def _minutes(m, n, ap=None):
    hh = int(m.group("h%d" % n))
    mm = int(m.group("m%d" % n) or m.group("mm%d" % n) or 0)
    if m.group("half%d" % n):
        mm = 30
    if hh > 24 or mm > 59:
        return None
    ap = ap or m.group("ap%d" % n)
    if ap == "午後" and hh < 12:
        hh += 12
    return hh * 60 + mm


def _find_ranges(text):
    """(開始位置, 終了位置, 開始分, 終了分)。「午後1時～5時」は両端とも午後（13～17時）。分が60以上などは None の分を返す。"""
    out = []
    for m in _RANGE.finditer(text):
        ap1, ap2 = m.group("ap1"), m.group("ap2")
        a = _minutes(m, 1)
        b = _minutes(m, 2, ap2 or (ap1 if ap1 == "午後" else None))
        out.append((m.start(), m.end(), a, b))
    return out


_CONDITION = re.compile(r"学校使用時|使用時のみ|利用時のみ|開設時|時間内|職員在室|有人|開催時|イベント時|貸出時|施設利用時|のみ")
_LOCKED = re.compile(r"施錠|鍵|インターホン|声をかけ|声を掛け|お声|呼び?出し|守衛に|警備員に")
_STRONG_ALL_DAY = re.compile(r"24\s*時間|24\s*h(?:ours?|r)?\b|常時|24時間365日|24-?7|年中無休|通年24|一日中|昼夜")
_WEAK_ALL_DAY = re.compile(r"終日")
_CLOSURE = re.compile(r"休館日|休園日|休業日|定休日|休診日|休館|休園|休業|閉館日|閉館|休日以外")
_OPEN_DAY = re.compile(r"開館日|開園日|営業日|開庁日|開所日|診療日|開設日")
_REGARDLESS = re.compile(r"問わず|関係なく|にかかわらず|に関わらず")
_DATE = r"\d{1,2}月(?:\d{1,2}日?)?|\d{1,2}/\d{1,2}"
_SEASONAL = re.compile(r"(?:" + _DATE + r")(?:\s*(?:~|〜|-|から)\s*(?:" + _DATE + r"))?\s*(?:は|の間|:|：)?\s*(?:午前|午後)?\d{1,2}\s*(?::|時)")
_DATE_SPAN = re.compile(r"(?:" + _DATE + r")(?:\s*(?:~|〜|-|から)\s*(?:" + _DATE + r"))?")
_CJK = r"一-龥々"
_DT = "月火水木金土日"
# 曜日の書き方。単独の1文字（「日」「月」）は「曜」が付くか、「土日」「土・日」「月～金」のときだけ曜日とみなす
_DAY_TOKENS = [
    (re.compile(r"([月火水木金土日])曜?日?\s*(?:~|〜|-|ー|から)\s*([月火水木金土日])曜日?(?![一-龥])|(?<![\d一-龥々])([月火水木金土日])\s*(?:~|〜|-|ー)\s*([月火水木金土日])(?![\d月一-龥])"), "range"),
    (re.compile(r"(?<![\d一-龥々])土日祝?(?:(?![一-龥])|(?=[除休以]))|(?<![\d一-龥々])土[・、,]日(?:(?![一-龥])|(?=[除休以]))|週末"), "weekend"),
    (re.compile(r"平日"), "weekday"),
    (re.compile(r"毎日|全日|年中無休|無休"), "every"),
    (re.compile(r"(?<![\d])([月火水木金土日])曜日?"), "single"),
    (re.compile(r"(?<![\d一-龥々])([月火水木金土日])(?:[・、,][月火水木金土日])+(?:(?![一-龥])|(?=[除休以]))"), "list"),
    (re.compile(r"(?<!年末年始の)(?<!年末年始)(?<!振替)(?<!祝)(?<!祭)休日(?![以除])"), "weekend"),
]
_AFTER_EXCL = re.compile(r"(?:[\s・、,]|及び|および|並びに|と|や|祝日?|祭日|祝休日|年末年始|\([^)]*\))*(?:は|を|も)?\s*(?:除く|除き|以外|休み|休館|休園|休業|休診|閉館|閉園|休(?!日))")
_BEFORE_CLOSED = re.compile(r"(?:休館日|休園日|休業日|定休日|休診日|閉館日|休み|休館|休園)[（(:：\s]*(?:毎週|毎)?\s*$")


def _span_days(kind, m):
    g = m.group(0)
    if kind == "range":
        a = m.group(1) or m.group(3)
        b = m.group(2) or m.group(4)
        return parse_days(a + "-" + b)
    if kind == "weekend":
        return [5, 6]
    if kind == "weekday":
        return list(WEEKDAYS)
    if kind == "every":
        return list(range(7))
    if kind == "single":
        return [DAYCH.index(m.group(1))]
    if kind == "list":
        return sorted({DAYCH.index(c) for c in g if c in DAYCH})
    return None


def _day_tokens(t):
    """曜日として書かれた箇所を [(開始, 終了, 曜日リスト, 除外か)] で返す。「除く」「休館」が付いたものは除外。"""
    t = t.replace("毎週", "  ")  # 位置をずらさない
    t = re.sub(r"[（(]祝[日休]*(?:の場合|は|の際)[^）)]*[）)]", lambda m: " " * len(m.group(0)), t)
    spans = []
    for rx, kind in _DAY_TOKENS:
        for m in rx.finditer(t):
            days = _span_days(kind, m)
            if not days:
                continue
            if re.search(r"第\s*[\d・,、]+\s*$", t[max(0, m.start() - 8):m.start()]):
                continue  # 「第1・3・5土曜日」は毎週ではない
            spans.append((m.start(), m.end(), days))
    spans.sort(key=lambda x: (x[0], -(x[1] - x[0])))
    kept, last_end = [], -1
    for st, en, days in spans:
        if st < last_end:
            continue  # 長いものを優先して重なりを捨てる
        kept.append((st, en, days))
        last_end = en
    out = []
    for st, en, days in kept:
        excl = bool(_AFTER_EXCL.match(t[en:en + 14])) or bool(_BEFORE_CLOSED.search(t[max(0, st - 12):st]))
        out.append((st, en, days, excl))
    return out


def _bad(reason):
    return {"kind": "unknown", "windows": [], "reason": reason}


def parse_freetext(text):
    """自由記述（例:「平日9:00-17:00、土日10:00-16:00」「24時間使用可能」「施設の開館時間」）を解釈する。"""
    raw = text or ""
    if re.search(r"[①-⑳㉑-㉟]", raw):
        return _bad("multi")  # 設置箇所ごとの条件が混ざっている
    t = _norm(raw)
    if not t:
        return _bad("empty")
    if _SEASONAL.search(t):
        return _bad("seasonal")
    t = _DATE_SPAN.sub("", t)  # 「12月29日～1月3日を除く」等の日付は反映しない（年末年始の扱いは限界として明示）
    ranges = _find_ranges(t)
    toks = _day_tokens(t)
    pos = sorted({d for _, _, ds, ex in toks if not ex for d in ds})
    excl = {d for _, _, ds, ex in toks if ex for d in ds}
    regardless = bool(_REGARDLESS.search(t))
    if not ranges:
        if (_STRONG_ALL_DAY.search(t) or _WEAK_ALL_DAY.search(t)) and not re.search(r"24時間\s*以外|24時間\s*不可|利用不可|使用不可", t):
            if _CONDITION.search(t) or _FACILITY.search(t) or _LOCKED.search(t):
                return _bad("conditional")
            if not _STRONG_ALL_DAY.search(t):
                return _bad("allday")  # 「終日」だけでは 24 時間か開館中かが区別できない
            days = list(range(7)) if regardless or not pos else pos
            days = [d for d in days if d not in excl]
            if not days:
                return _bad("garbled")
            return _result([[d, 0, 1440] for d in days])
        if _FACILITY.search(t):
            return _bad("facility")
        return _bad("no_time" if re.search(r"\d", t) else "garbled")
    if any(a is None or b is None for _, _, a, b in ranges):
        return _bad("bad_range")
    windows = []
    last_days = None
    prev_end = 0
    for st, en, a, b in ranges:
        seg_toks = [x for x in toks if x[0] >= prev_end and x[1] <= st and not x[3]]
        days = None
        if regardless:
            days = list(range(7))
        elif seg_toks:
            # 直前から、「、」「・」「及び」だけでつながる曜日表記をまとめる
            grp = [seg_toks[-1]]
            for x in reversed(seg_toks[:-1]):
                if re.fullmatch(r"[\s、,・及びと]*", t[x[1]:grp[0][0]]):
                    grp.insert(0, x)
                else:
                    break
            days = sorted({d for x in grp for d in x[2]})
        if days is None:
            days = last_days
        if days is None and excl:
            days = list(range(7))  # 休む曜日だけが書かれている: それ以外の曜日に使えるとみなす
        if days is None:
            if _CLOSURE.search(t):
                return _bad("closure")  # 休館日以外、とだけあって曜日が書かれていない
            if _OPEN_DAY.search(t):
                return _bad("facility")  # 「開館日」がいつか書かれていない
            return _bad("no_day")  # 曜日の記載がない: 毎日とは決めつけない
        last_days = days
        use = [d for d in days if d not in excl]
        if not use:
            return _bad("garbled")
        if (a == 0 and b in (1440, 1439)) or (a == 0 and b == 0):
            _add_range(windows, use, 0, 1440)
        elif not _add_range(windows, use, a, b):
            return _bad("bad_range")
        prev_end = en
    return _result(windows)


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
        if int(ms.group(2)) > 59 or int(me.group(2)) > 59 or int(ms.group(1)) > 24 or int(me.group(1)) > 24:
            return {"kind": "unknown", "windows": [], "reason": "bad_range"}
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


_PAREN = re.compile(r"[（(][^（）()]*[）)]")
_NTH_OR_MONTH = re.compile(r"毎月|第\s*[\d・,、]+|[\d・]+月|夏季|冬季|中旬|上旬|下旬")
_COND_NOTE = re.compile(r"場合のみ|時のみ|中のみ|のみ(?:利用|使用)可能|のみ$|(?:利用|使用)は.*のみ")


def _strip_paren(s):
    prev = None
    while prev != s:
        prev = s
        s = _PAREN.sub("", s)
    return s


def apply_special_note(avail, note, log=None):
    """自治体標準オープンデータの「利用可能日時特記事項」を、曜日・時間に反映できる範囲で反映する。

    戻り値 (avail, status)。status:
      "none"        特記事項なし
      "noted"       特記事項はあるが、反映できる曜日・時間の記載がない（祝日・年末年始・第N週・季節限定など）。曜日欄・時間欄のままにする
      "applied"     「土曜日、日曜日…の利用可能時間は8:00～21:00」「日曜日…は終日利用不可」を曜日・時間に反映した
      "conditional" 「施設の貸出がある場合のみ」など条件付きで、いつ使えるか読めない → 不明にした
    反映しないもの: 祝日・年末年始・「第N○曜日」・月や季節で限定された記載・「学校休校日」のような曜日でない限定。
    """
    out = dict(avail)
    n = _strip_paren(_norm(note))
    if not n:
        return out, "none"
    if avail["kind"] == "unknown":
        return out, "noted"
    per_day = {d: [] for d in range(7)}
    for d, a, b in avail["windows"]:
        per_day[d].append([a, b])
    applied = False
    for sent in re.split(r"[。＊*\n]", n):
        sent = sent.strip()
        if not sent:
            continue
        if _COND_NOTE.search(sent):
            if log is not None:
                log.append(("conditional", sent))
            return {"kind": "unknown", "windows": [], "reason": "conditional", "assumed": False}, "conditional"
        cut = _NTH_OR_MONTH.search(sent)
        head = sent[:cut.start()] if cut else sent
        toks = [x for x in _day_tokens(head) if not x[3] and head[x[1]:x[1] + 1] != "が"]
        days = sorted({d for x in toks for d in x[2]})
        m = re.search(r"(利用可能時間|利用開始時間|利用終了時間)は", head)
        if m:
            before = head[:m.start()]
            tk = [x for x in _day_tokens(before) if not x[3]]
            rest = before
            for st, en, _, _ in sorted(tk, reverse=True):
                rest = rest[:st] + rest[en:]
            rest = re.sub(r"[\s、,・の祝休日]+", "", rest)
            ds = sorted({d for x in tk for d in x[2]})
            spec = head[m.end():]
            r2 = re.match(r"\s*(\d{1,2}):(\d{2})\s*(?:~|〜|-)\s*(\d{1,2}):(\d{2})", spec)
            r1 = re.match(r"\s*(\d{1,2}):(\d{2})\s*(まで|以降|から)", spec)
            if cut or rest or not ds or m.group(1) != "利用可能時間" or not (r2 or r1):
                if log is not None:
                    log.append(("partial", sent))
                continue
            if r2:
                a, b = int(r2.group(1)) * 60 + int(r2.group(2)), int(r2.group(3)) * 60 + int(r2.group(4))
                if a >= b or b > 1440 or int(r2.group(2)) > 59 or int(r2.group(4)) > 59:
                    continue
                for d in ds:
                    per_day[d] = [[a, b]]
                applied = True
            else:
                v = int(r1.group(1)) * 60 + int(r1.group(2))
                for d in ds:
                    if r1.group(3) == "まで":
                        per_day[d] = [[a, min(b, v)] for a, b in per_day[d] if a < v]
                    else:
                        per_day[d] = [[max(a, v), b] for a, b in per_day[d] if v < b]
                applied = True
            continue
        if re.search(r"(?:終日)?(?:利用|使用)不可", sent) and not re.search(r"場合は利用可能", sent):
            if days:
                for d in days:
                    per_day[d] = []
                applied = True
            elif log is not None:
                log.append(("holiday_only", sent))
            continue
        if log is not None:
            log.append(("ignored", sent))
    wins = [[d, a, b] for d in range(7) for a, b in per_day[d]]
    if not applied:
        return out, "noted"
    r = _result(wins, "garbled")
    r["assumed"] = avail.get("assumed", False)
    return r, "applied"


_NONPUBLIC = re.compile(r"救急車|車内|病棟内|病室|診察室|診療室|医務室|処置室|手術室|調剤|外来(?![及とや])")
_OFFICE = re.compile(r"事務所|事務室|職員室")
_OUTSIDE = re.compile(r"外壁|外側|ボックス|屋外|入口|入り口|出入|玄関|前|横|側|付近|外")


def classify_access(name, place, avail):
    """設置位置から、一般の人が使えるか判断する。戻り値 (avail, access)。access は "public" か "nonpublic"。

    nonpublic: 救急車の中、病室・病棟内の廊下・診察室・診療室・医務室・処置室・手術室、外来診療の部屋。AED は実在するが、通りがかりの人が取りに行ける位置ではない。
    ロビー・コンコース・玄関など、病院や施設の共用部は数える（夜間に建物へ入れるかは確認できないので、README に限界として書く）。
    事務所・事務室・職員室の中（外壁の収納ボックスや入口付近ではないもの）にあり 24 時間とされたものは、施錠される部屋の可能性が高く、夜間に使えるとは確認できないので不明（conditional）にする。
    """
    where = (name or "") + " " + (place or "")
    if _NONPUBLIC.search(where):
        return avail, "nonpublic"
    if avail["kind"] == "24h" and _OFFICE.search(place or "") and not _OUTSIDE.search(place or ""):
        r = {"kind": "unknown", "windows": [], "reason": "conditional", "assumed": avail.get("assumed", False)}
        return r, "public"
    return avail, "public"


def is_usable(windows, day, minute):
    """day=0..6（月..日）、minute=0..1439 の時刻に使えるか。"""
    return any(d == day and s <= minute < e for d, s, e in windows)
