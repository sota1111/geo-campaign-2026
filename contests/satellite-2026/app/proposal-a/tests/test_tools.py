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


class VerifyTools(unittest.TestCase):
    """国交省 02.xlsx の検証（町単位）の部品。"""

    def test_pip_square_with_hole(self):
        import verify_incidents as vi
        outer = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        hole = [(4, 4), (6, 4), (6, 6), (4, 6), (4, 4)]
        self.assertTrue(vi.pip(1, 1, [outer, hole]))
        self.assertFalse(vi.pip(5, 5, [outer, hole]))   # 穴は偶奇則で外
        self.assertFalse(vi.pip(11, 5, [outer]))

    def test_auc_and_spearman(self):
        import verify_incidents as vi
        self.assertEqual(vi.auc([3], [1, 2]), 1.0)
        self.assertEqual(vi.auc([1], [1]), 0.5)
        self.assertIsNone(vi.auc([], [1]))
        self.assertAlmostEqual(vi.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(vi.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_clean_removes_furigana_and_newline(self):
        import verify_incidents as vi
        self.assertEqual(vi.clean('豊中市トヨナカシ'), '豊中市')
        self.assertEqual(vi.clean('道路排水施設\n（側溝）'), '道路排水施設（側溝）')
        self.assertEqual(vi.town_of_incident('大阪府豊中市宝山町地先'), '宝山町')
        self.assertIsNone(vi.town_of_incident('香川県三豊市豊中町上高野地先'))

    def test_weighted_median(self):
        import verify_incidents as vi
        self.assertEqual(vi.wmedian([(1960, 1), (1980, 1), (2000, 10)]), 2000)
        self.assertEqual(vi.wmedian([(1960, 5), (1980, 1)]), 1960)

    def test_polygon_reader_type5(self):
        import struct, tempfile, shp
        ring = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.0, 0.0)]
        body = struct.pack('<i', 5) + struct.pack('<4d', 0, 0, 1, 1) + struct.pack('<ii', 1, len(ring)) + struct.pack('<i', 0)
        body += b''.join(struct.pack('<dd', x, y) for x, y in ring)
        rec = struct.pack('>ii', 1, len(body) // 2) + body
        with tempfile.NamedTemporaryFile(suffix='.shp') as f:
            f.write(b'\0' * 100 + rec)
            f.flush()
            out = list(shp.read_polygons(f.name))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][0][0], (0.0, 0.0))


if __name__ == '__main__':
    unittest.main()
