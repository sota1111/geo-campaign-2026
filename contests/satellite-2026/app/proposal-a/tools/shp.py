"""最小限のシェープファイル読み取り（ポリライン + DBF）。外部ライブラリ不要。
未信頼ファイルを読むので、必ず `python3 -I` 経由の呼び出し元から使う。"""
import struct


def read_dbf(path, encoding='cp932'):
    with open(path, 'rb') as f:
        head = f.read(32)
        n, hlen, rlen = struct.unpack('<xxxxIHH', head[:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0:1] == b'\r' or len(d) < 32:
                break
            name = d[:11].split(b'\0')[0].decode('ascii', 'replace')
            fields.append((name, d[11:12].decode(), d[16]))
        f.seek(hlen)
        for _ in range(n):
            rec = f.read(rlen)
            if len(rec) < rlen:
                break
            deleted = rec[0:1] == b'*'
            off = 1
            row = {}
            for name, typ, ln in fields:
                row[name] = rec[off:off + ln].decode(encoding, 'replace').strip()
                off += ln
            yield deleted, row


def read_polygons(path):
    """ポリゴン（型 5 / 15 / 25）。各レコードを [リング(頂点リスト), ...] で返す。ほかは None。
    穴は区別せず、点の内外判定は全リングでの偶奇則で行う前提。"""
    with open(path, 'rb') as f:
        f.read(100)
        while True:
            h = f.read(8)
            if len(h) < 8:
                return
            _, clen = struct.unpack('>ii', h)
            body = f.read(clen * 2)
            st = struct.unpack('<i', body[:4])[0]
            if st not in (5, 15, 25):
                yield None
                continue
            nparts, npts = struct.unpack('<ii', body[36:44])
            parts = list(struct.unpack('<%di' % nparts, body[44:44 + 4 * nparts]))
            po = 44 + 4 * nparts
            pts = [struct.unpack('<dd', body[po + 16 * i:po + 16 * i + 16]) for i in range(npts)]
            parts.append(npts)
            yield [pts[parts[i]:parts[i + 1]] for i in range(nparts)]


def read_polylines(path):
    """各レコードを (parts を連結した頂点リストのリスト) として返す。範囲外は None。"""
    with open(path, 'rb') as f:
        f.read(100)
        while True:
            h = f.read(8)
            if len(h) < 8:
                return
            _, clen = struct.unpack('>ii', h)
            body = f.read(clen * 2)
            st = struct.unpack('<i', body[:4])[0]
            if st == 0:
                yield None
                continue
            if st not in (3, 13, 23):
                yield None
                continue
            nparts, npts = struct.unpack('<ii', body[36:44])
            parts = list(struct.unpack('<%di' % nparts, body[44:44 + 4 * nparts]))
            po = 44 + 4 * nparts
            pts = [struct.unpack('<dd', body[po + 16 * i:po + 16 * i + 16]) for i in range(npts)]
            parts.append(npts)
            yield [pts[parts[i]:parts[i + 1]] for i in range(nparts)]
