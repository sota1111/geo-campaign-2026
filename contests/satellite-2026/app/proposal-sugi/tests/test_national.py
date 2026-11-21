"""全国版 tools/national_*.py の純粋関数の単体テスト（ネット不要）。
実行: python3 -I -m unittest discover -s tests -p 'test_*.py'  （proposal-sugi ディレクトリで）"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tools'))
import national_jouyo as J  # noqa: E402
import national_pop as P  # noqa: E402

try:
    import national_mesh as M  # numpy・pyproj が要る
except ImportError:  # pragma: no cover
    M = None


class Jouyo(unittest.TestCase):
    TXT = """令和６年度    森林環境譲与税 譲与額（市区町村別）
 都道府県    市区町村   ９月期  ３月期  合計   都道府県   市区町村  ９月期  ３月期  合計
 北海道    札幌市     154,283   148,463     302,746   北海道    留寿都村      4,398     4,232       8,630
 千葉県    鎌ケ谷市      6,390     6,149      12,539   東京都    江戸川区     40,452    38,926      79,378
"""

    def test_two_column_rows(self):
        r = J.parse_jouyo(self.TXT)
        self.assertEqual(len(r), 4)
        self.assertEqual(r[('北海道', '札幌市')]['total'], 302746)
        self.assertEqual(r[('東京都', '江戸川区')]['total'], 79378)

    def test_norm_unifies_small_ke(self):
        self.assertEqual(J.norm('鎌ヶ谷市'), J.norm('鎌ケ谷市'))

    def test_bundled_table_matches_published_total(self):
        d = json.load(open(os.path.join(HERE, '..', 'tools', 'jouyo_r6.json'), encoding='utf-8'))
        self.assertEqual(len(d['rows']), 1741)  # 全国の市区町村数（総務省の表）
        self.assertEqual(sum(r['total'] for r in d['rows']), 56601856)  # 表の「区域内市区町村計」（千円）
        self.assertEqual(len(J.PREFS), 47)


class Pop(unittest.TestCase):
    def test_center_of_1km_mesh(self):
        lat, lon = P.center('53394611')
        self.assertAlmostEqual(lat, 53 * 40 / 60 + 4 * 5 / 60 + 1 * 30 / 3600 + 15 / 3600, places=6)
        self.assertAlmostEqual(lon, 100 + 39 + 6 * 7.5 / 60 + 1 * 45 / 3600 + 22.5 / 3600, places=6)


@unittest.skipIf(M is None, 'numpy / pyproj がない')
class Mesh(unittest.TestCase):
    def test_direct_url_drops_redirect(self):
        u = 'https://www.geospatial.jp/ckan/dataset/fb5ab048/resource/ceaef1db-90b1-4bed-a460-9325e64d248f/download/fr_mesh20m_01fd1_2025.7z'
        self.assertEqual(M.direct(u), 'https://gsic-opendata.s3.amazonaws.com/ckan/resources/ceaef1db-90b1-4bed-a460-9325e64d248f/fr_mesh20m_01fd1_2025.7z')
        self.assertEqual(M.direct('https://example.com/x'), 'https://example.com/x')

    def test_clean_removes_only_files_one_by_one(self):
        import tempfile
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, 'a', 'b'))
        open(os.path.join(d, 'a', 'b', 'f.txt'), 'w').close()
        M.clean(d)
        self.assertFalse(os.path.exists(d))


if __name__ == '__main__':
    unittest.main()
