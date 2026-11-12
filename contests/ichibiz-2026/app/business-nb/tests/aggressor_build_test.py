"""アグレッサーの失敗テスト（ichibiz-2026 新案NB: データ生成 build_data.py）。2026-11-13

usage: python3 tests/aggressor_build_test.py [-v]
  環境変数 NB_APP でアプリの場所を変えられる（既定: contests/ichibiz-2026/app/business-nb）。
本来の置き場所は app/business-nb/tests/ だが、書き込み範囲の hook で拒否されたためここに置く。
ネットワークには出ない（地理院APIの応答を差し替える）。FAIL は弱点が残っていることを示す。

A1: 地理院の住所検索APIは、郡部の町字の title を「郡」を省いて返す
    （2026-11-13 に実APIで確認: q=京都府与謝郡与謝野町三河内 → title=京都府与謝野町三河内）。
    build_data.geocode() はクエリ（郡あり）で title が始まるかを見るため、郡部の町字がすべて不一致になり、
    市区町村の代表点に落ちる。市区町村代表点 1,048件のうち 918件がこの郡部町村。
"""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

APP = Path(os.environ.get("NB_APP", Path(__file__).resolve().parents[1])).resolve()  # 移設時の変更はここだけ
sys.path.insert(0, str(APP))
import build_data as b  # noqa: E402


def fake_urlopen(payload):
    def _open(url, timeout=None):
        return io.BytesIO(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    return _open


class TestGunGeocode(unittest.TestCase):
    def _geocode(self, q, payload, floor=0):
        with mock.patch.object(b.urllib.request, "urlopen", fake_urlopen(payload)), mock.patch.object(b.time, "sleep", lambda s: None):
            return b.geocode(q, {}, False, floor)

    def test_a1_gun_town_title_without_gun_is_accepted(self):
        payload = [{"geometry": {"coordinates": [135.090485, 35.517967], "type": "Point"},
                    "type": "Feature", "properties": {"addressCode": "", "title": "京都府与謝野町三河内"}}]
        g = self._geocode("京都府与謝郡与謝野町三河内", payload, floor=len("京都府与謝郡与謝野町"))
        self.assertIsNotNone(g, "郡を省いた title（京都府与謝野町三河内）を採用できず、市区町村の代表点に落ちる")

    def test_a1_gun_town_oaza_floor_is_accepted(self):
        # 小字まで付いたクエリで、APIが大字までの title（郡なし）を返す場合
        payload = [{"geometry": {"coordinates": [135.4, 35.17], "type": "Point"},
                    "type": "Feature", "properties": {"addressCode": "", "title": "京都府京丹波町三ノ宮"}}]
        g = self._geocode("京都府船井郡京丹波町三ノ宮縄手", payload, floor=len("京都府船井郡京丹波町"))
        self.assertIsNotNone(g, "大字までの title（郡なし）も採用できない")

    def test_a1_non_gun_still_works(self):
        # 対照: 郡のない市の町字は今も採用される（このテストは PASS する想定）
        payload = [{"geometry": {"coordinates": [135.73, 34.98], "type": "Point"},
                    "type": "Feature", "properties": {"addressCode": "", "title": "京都府京都市南区吉祥院観音堂南町"}}]
        self.assertIsNotNone(self._geocode("京都府京都市南区吉祥院観音堂南町", payload, floor=len("京都府京都市南区")))

    def test_a1_cache_gun_town_hit_rate(self):
        cache = json.loads((APP / "cache" / "geocode.json").read_text(encoding="utf-8"))
        gun_town = [k for k in cache if "郡" in k and not k.endswith(("町", "村"))]
        hit = sum(1 for k in gun_town if cache[k])
        self.assertGreater(hit / max(1, len(gun_town)), 0.5,
                           f"郡部の町字クエリ {len(gun_town)}件のうち位置が取れたのは {hit}件")


class TestFacilityScope(unittest.TestCase):
    def test_a2_facilities_beyond_prefecture(self):
        # 法律（令和8年法律第33号）の認定事業者は都道府県ごとの廃棄物処理法の許可が不要（情報部 nb-facts 1-1）。
        # 府県境をまたぐ回収が制度上想定されるのに、施設は京都府の公表3社のみ。圏外の割合が府境で過大になりうる。
        fac = json.loads((APP / "web" / "data" / "facilities.json").read_text(encoding="utf-8"))
        outside = [f for f in fac if not f["address"].startswith("京都府")]
        self.assertGreater(len(outside), 0, "府外の施設が0件")


if __name__ == "__main__":
    unittest.main(verbosity=2)
