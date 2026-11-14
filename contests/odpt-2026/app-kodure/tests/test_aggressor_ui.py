"""アグレッサー（2026-11-14）: 子連れお出かけ診断の画面の失敗テスト（ヘッドレスChrome。無ければスキップ）。

配置先: contests/odpt-2026/app-kodure/tests/test_aggressor_ui.py（書き込みガードのため、ここに置いた）。
コピーせずに実行する場合: cd contests/odpt-2026/app-kodure && PYTHONPATH=tests python3 <このファイル>
tests/ui_shot.mjs（工兵の確認ツール）を評価式つきで呼び、"eval -> ..." の出力を見る。
"""
import functools
import http.server
import json
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest

import kh

WEB = kh.ROOT / "web"
SHOT = kh.ROOT / "tests" / "ui_shot.mjs"
META = kh.load_meta()
HAVE = shutil.which("google-chrome") and shutil.which("node") and SHOT.exists() and kh.HAVE_DATA


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@unittest.skipUnless(HAVE, "google-chrome / node / ui_shot.mjs か web/data が無い（web/data は許諾確認中で未同梱）")
class TestUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", cls.port), h)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.tmp = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def run_eval(self, hash_, js, w=1280, h=800):
        url = "http://127.0.0.1:%d/%s" % (self.port, hash_)
        out = subprocess.run(["node", str(SHOT), url, self.tmp + "/s.png", str(w), str(h), js],
                             capture_output=True, text=True, timeout=180).stdout
        for line in out.splitlines():
            if line.startswith("eval -> "):
                return line[len("eval -> "):]
        self.fail("ui_shot の出力に eval が無い: " + out[-500:])

    def test_headline_matches_loaded_data(self):
        """徒歩上限を800mに変えた直後（データ読み込み中）に許容時間を変えると、見出しは「徒歩1回800m以内」なのに
        数字は500mのデータ（77.2%＝500m・60分の値）で描かれる。読み込みに失敗すると、この食い違いが残る。"""
        js = ("(function(){document.querySelectorAll('#ctl-c button')[2].click();"
              "document.querySelectorAll('#ctl-w button')[2].click();"
              "return JSON.stringify({key:App.STATE.matsKey,c:App.STATE.c,head:document.getElementById('headline').textContent})})()")
        r = json.loads(self.run_eval("", js))
        if "800m" in r["head"] and "%" in r["head"]:
            self.assertTrue(r["key"].endswith("_800"),
                            "見出しは800mの条件だが、描いている数字は %s のデータ: %s" % (r["key"], r["head"][:80]))

    def test_no_kinds_headline_not_zero_percent(self):
        """共有リンクで行き先の種類が空（k=）だと、固定表示の見出しが「0% の子どもに、行き帰りとも行ける行き先がある」になる
        （警告はパネルの中だけ。スマホでは見出ししか見えない）。"""
        head = self.run_eval("#o=9&r=16&w=45&c=500&t=2&k=&v=a", "document.getElementById('headline').textContent", 390, 844)
        self.assertNotIn("0% の子ども", head)

    def test_shared_dest_link_shows_dest_on_mobile(self):
        """行き先を選んだ共有リンク（v=b&s=…）をスマホで開くと、地図がその行き先へ移動せず、選んだ点が画面に入らない。"""
        names = [d[2] for d in META["dests"]]
        i = names.index("しながわ水族館")
        d = META["dests"][i]
        js = "App.getMap().getBounds().contains([%f,%f])" % (d[0], d[1])
        got = self.run_eval("#o=9&r=16&w=45&c=500&t=2&v=b&s=%d" % i, js, 390, 844)
        self.assertEqual(got.lower(), "true", "選んだ行き先（しながわ水族館）が地図の表示範囲に無い")


if __name__ == "__main__":
    unittest.main()
