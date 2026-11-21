"""取得・前処理スクリプトの単体テスト（ネットワーク不要）。usage: python3 -m unittest tests/test_tools.py（proposal-a/ で実行）"""
import os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tools'))
import insar_cells as ic  # noqa: E402
import build_data as bd  # noqa: E402


class InsarClasses(unittest.TestCase):
    def test_class_width_and_range(self):
        self.assertEqual(ic.CLASS_W, 3.75)
        self.assertEqual(ic.class_range(7), (-3.75, 0.0))
        self.assertEqual(ic.class_range(8), (0.0, 3.75))
        self.assertAlmostEqual(ic.class_mid(7), -1.875)
        self.assertAlmostEqual(ic.class_mid(0), -28.125)
        self.assertAlmostEqual(ic.class_range(15)[1], 30.0)

    @unittest.skipUnless(os.path.exists(os.path.join(ic.CACHE, 'legend_qu.png')), '凡例画像が未取得（tools/fetch_insar.py）')
    def test_legend_has_16_distinct_colors_blue_to_red(self):
        leg = ic.legend_colors()
        self.assertEqual(len(leg), 16)
        self.assertEqual(len({tuple(c) for c in leg}), 16)
        self.assertGreater(leg[0][2], leg[0][0])    # 沈下側は青
        self.assertGreater(leg[15][0], leg[15][2])  # 隆起側は赤


class RoadSplit(unittest.TestCase):
    def test_straight_long_line_is_split_evenly(self):
        parts = bd.split_piece([(0, 0), (400, 0)])
        self.assertEqual(len(parts), 3)
        self.assertTrue(all(bd.polylen(p) <= bd.MAX_SEG_M + 1e-9 for p in parts))
        self.assertAlmostEqual(sum(bd.polylen(p) for p in parts), 400)

    def test_curve_is_split_at_bend(self):
        parts = bd.split_piece([(0, 0), (50, 0), (50, 50)])
        self.assertEqual(len(parts), 2)

    def test_short_straight_is_kept(self):
        self.assertEqual(len(bd.split_piece([(0, 0), (30, 0)])), 1)

    def test_distance_point_segment(self):
        self.assertAlmostEqual(bd.d_pt_seg(5, 3, 0, 0, 10, 0), 3)
        self.assertAlmostEqual(bd.d_pt_seg(-4, 3, 0, 0, 10, 0), 5)


if __name__ == '__main__':
    unittest.main()
