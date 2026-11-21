"""HTTP Range の GET だけで、巨大な ZIP（PLATEAU 東京23区 2022年度 CityGML、約5GB）から必要なエントリだけを読む。

POST・認証・保存はしない。ZIP 全体はダウンロードしない（末尾の目次と、読むエントリだけを取る）。
"""
import io
import urllib.request
import zipfile

# G空間情報センター「3D都市モデル（Project PLATEAU）東京23区（2022年度）」CityGML（v2）。ライセンス: PLATEAU Site Policy 3（著作権）
PLATEAU_CITYGML_URL = "https://assets.cms.plateau.reearth.io/assets/74/b317b5-a7b0-426f-ba8b-af5f777c76c5/13100_tokyo23-ku_2022_citygml_1_2_op.zip"


class RemoteFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.pos = 0
        req = urllib.request.Request(url, method="HEAD")
        self.size = int(urllib.request.urlopen(req, timeout=60).headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        if n <= 0:
            return b""
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        d = urllib.request.urlopen(req, timeout=120).read()
        self.pos += len(d)
        return d

    def readinto(self, b):
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


def open_zip(url=PLATEAU_CITYGML_URL):
    return zipfile.ZipFile(io.BufferedReader(RemoteFile(url), buffer_size=1 << 20))
