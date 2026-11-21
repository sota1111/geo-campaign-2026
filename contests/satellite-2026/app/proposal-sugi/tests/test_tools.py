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


class PopExposure(unittest.TestCase):
    def test_disc_sum_and_radius(self):
        import kanto_pop as KP
        # 1つのメッシュ(ix,iy)に 1000人。同じ位置では全半径で1000人、東へ約18km（lon +0.2度）離れた点は R=10 で0・R=20 で1000
        ix0, iy0 = 22400, 8500
        pop = [((iy0 + 0.5) / 240, (ix0 + 0.5) / 160, 1000)]
        out = KP.exposure([ix0, ix0 + 32], [iy0, iy0], pop)
        self.assertAlmostEqual(out[10][0], 1000, delta=1)
        self.assertAlmostEqual(out[10][1], 0, delta=1)
        self.assertAlmostEqual(out[20][1], 1000, delta=1)


class Verify9Parse(unittest.TestCase):
    def test_parse_table(self):
        import kanto_verify9 as V
        names = V.NAMES
        t2 = '表２ 2018 年花粉飛散数予測の解析データ\n' + '\n'.join('2009   21    7,281    ' + '    '.join(str(1000 + i) for i in range(12))
                                                               for _ in range(1)) + '\n'
        t2 += '2010   22    4,005    ' + '    '.join(str(2000 + i) for i in range(12)) + '\n'
        t3 = '表３ 2018 年飛散予測花粉数\n' + ''.join('%s    %s\n' % (lab, '   '.join(['1'] * 12)) for lab in ('回帰係数', '定数項', '決定係数 R2', '観測年数', '予測花粉数/cm2'))
        years, coef = V.parse(t2 + t3)
        self.assertEqual(sorted(years), [2009, 2010])
        self.assertEqual(years[2009]['sites'][names[0]], 1000)
        self.assertEqual(years[2010]['bloom'], 4005)
        self.assertEqual(len(coef['coef']), 12)


if __name__ == '__main__':
    unittest.main()
