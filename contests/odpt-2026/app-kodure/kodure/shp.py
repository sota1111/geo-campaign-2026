"""シェープファイル（点）と dbf の最小の読み込み。標準ライブラリのみ。

国土数値情報の P13（都市公園）・P27（文化施設）は、GML のほかに shp/dbf でも配布されている。
GML(XML) を読むより単純なので、点データに限って shp から座標、dbf から属性を読む。
"""
import io
import struct
import zipfile


def read_dbf(data: bytes, encoding="cp932"):
    """dbf のバイト列 -> [{フィールド名: 文字列}]（削除済みレコードは除く）。"""
    n, header_len, rec_len = struct.unpack("<xxxxIHH", data[:12])
    fields = []
    o = 32
    while data[o] != 0x0D:
        name = data[o:o + 11].split(b"\0")[0].decode("ascii")
        fields.append((name, data[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        rec = data[header_len + i * rec_len: header_len + (i + 1) * rec_len]
        if rec[:1] == b"*":
            rows.append(None)   # 削除済み。shp との対応を保つため位置は残す
            continue
        p = 1
        row = {}
        for name, ln in fields:
            row[name] = rec[p:p + ln].decode(encoding, "replace").strip()
            p += ln
        rows.append(row)
    return rows


def read_shp_points(data: bytes):
    """shp のバイト列 -> [(経度, 緯度)]（点型 type=1 のレコード順。他の型は None）。"""
    out = []
    o = 100
    while o + 8 <= len(data):
        _num, length = struct.unpack(">ii", data[o:o + 8])
        body = data[o + 8:o + 8 + length * 2]
        o += 8 + length * 2
        if len(body) >= 20 and struct.unpack("<i", body[:4])[0] == 1:
            x, y = struct.unpack("<dd", body[4:20])
            out.append((x, y))
        else:
            out.append(None)
    return out


def read_points_zip(zip_path, stem_suffix=".shp"):
    """zip 内の最初の .shp と同名の .dbf を読み、[(経度, 緯度, 属性dict)] を返す。"""
    with zipfile.ZipFile(zip_path) as zf:
        shp_name = next(n for n in zf.namelist() if n.lower().endswith(stem_suffix))
        base = shp_name[:-len(stem_suffix)]
        shp = zf.read(shp_name)
        dbf = zf.read(next(n for n in zf.namelist() if n.lower() == (base + ".dbf").lower()))
    pts = read_shp_points(shp)
    rows = read_dbf(dbf)
    return [(p[0], p[1], r) for p, r in zip(pts, rows) if p is not None and r is not None]
