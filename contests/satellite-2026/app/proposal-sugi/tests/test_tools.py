"""tools/ の純粋関数の単体テスト（ネット・shapely 不要）。
実行: python3 -I -m unittest discover -s tests -p 'test_*.py'  （proposal-sugi ディレクトリで）"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import fetch_population as P  # noqa: E402
import fetch_wind as W  # noqa: E402


class Mesh250(unittest.TestCase):
    def test_center(self):
        lat, lon = P.mesh250_center('5339000541')
        self.assertAlmostEqual(lat, 35.3333333 + 15 / 3600 + 3.75 / 3600, places=4)
        self.assertAlmostEqual(lon, 139 + 5 * 45 / 3600 + 22.5 / 3600 + 5.625 / 3600, places=4)

    def test_quadrants_are_ordered(self):
        sw = P.mesh250_center('5339000511')
        ne = P.mesh250_center('5339000514')
        self.assertLess(sw[0], ne[0])
        self.assertLess(sw[1], ne[1])


class WindParse(unittest.TestCase):
    def test_parse_most_frequent_direction(self):
        cells = ['1', '0.0', '0.0', '0.0', '11.2', '19.8', '2.9', '///', '///', '1.8', '4.8', '南南東', '9.1', '東南東', '西', '10.2', '///', '///']
        html = '<tr class="mtx">' + ''.join('<td>%s</td>' % c for c in cells) + '</tr><tr class="mtx"><td>日</td></tr>'
        self.assertEqual(W.parse(html), ['西'])

    def test_dirs_are_16(self):
        self.assertEqual(len(W.DIRS), 16)
        self.assertEqual(len(set(W.DIRS)), 16)


if __name__ == '__main__':
    unittest.main()
