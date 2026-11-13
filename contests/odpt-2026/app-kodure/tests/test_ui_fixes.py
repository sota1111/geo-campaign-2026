"""デザイン審査（2026-11-14）の指摘を直した画面の検査（ヘッドレスChrome。無ければスキップ）。"""
import json
import unittest

import kh
from test_aggressor_ui import TestUI as _Base, HAVE


@unittest.skipUnless(HAVE, "google-chrome / node / ui_shot.mjs が無い")
class TestUIFixes(_Base):
    # 親クラスのテストは再実行しない（親の検査は test_aggressor_ui で実行される）
    test_headline_matches_loaded_data = None
    test_no_kinds_headline_not_zero_percent = None
    test_shared_dest_link_shows_dest_on_mobile = None

    def test_mobile_map_padding_excludes_panel(self):
        """スマホでは下部パネルの高さ分を地図の余白にして、選んだ場所がパネルの裏に隠れない（審査 S1）。"""
        js = "JSON.stringify([App.getMap().getPadding().bottom, document.getElementById('panel').offsetHeight])"
        bottom, panel = json.loads(self.run_eval("", js, 390, 844))
        self.assertGreaterEqual(bottom, panel)

    def test_desktop_map_padding_excludes_panel(self):
        js = "JSON.stringify([App.getMap().getPadding().left, document.getElementById('panel').offsetWidth])"
        left, panel = json.loads(self.run_eval("", js, 1280, 800))
        self.assertGreaterEqual(left, panel)

    def test_headline_visible_on_desktop_first_screen(self):
        """結論（見出し）が、PCでもスクロールせずに最初の画面にある（審査 M1）。"""
        js = "JSON.stringify([document.getElementById('headline').getBoundingClientRect().bottom, document.getElementById('headline').textContent.indexOf('%')])"
        bottom, pos = json.loads(self.run_eval("", js, 1280, 800))
        self.assertLess(bottom, 200)
        self.assertGreaterEqual(pos, 0)

    def test_dest_selection_fits_reachable_area_within_visible_map(self):
        """行き先を選ぶと、そこへ行ける地区の全体が、見えている地図に収まる（審査 S1 の直し方3）。"""
        js = ("(function(){var m=App.getMap(),b=m.getBounds(),S=App.STATE,mt=S.meta,c=[];"
              "S.statuses.forEach(function(s,i){if(s==='both')c.push(i)});"
              "var L=window.Lib,ok=c.every(function(i){var bb=L.meshBounds(mt.cells[i][0]);return b.contains([(bb[0]+bb[2])/2,(bb[1]+bb[3])/2])});"
              "return JSON.stringify([c.length,ok])})()")
        names = [d[2] for d in json.loads((kh.ROOT / "web" / "data" / "meta.json").read_text(encoding="utf-8"))["dests"]]
        i = names.index("科学技術館")
        n, ok = json.loads(self.run_eval("#o=9&r=16&w=45&c=500&t=2&v=b&s=%d" % i, js, 1280, 800))
        self.assertGreater(n, 0)
        self.assertTrue(ok)

    def test_osaka_headline_says_position_only(self):
        """大阪表示では、最初の画面（固定見出し）で、位置だけの表示であることが分かる（審査 M6）。"""
        head = self.run_eval("#region=osaka", "document.getElementById('headline').textContent", 390, 844)
        self.assertIn("位置だけ", head)


if __name__ == "__main__":
    unittest.main()
