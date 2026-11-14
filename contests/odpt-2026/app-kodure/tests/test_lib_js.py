import shutil
import subprocess
import unittest

import kh


@unittest.skipUnless(shutil.which("node") and kh.HAVE_DATA, "node か web/data が無い（web/data は国土数値情報 P13・P27 の許諾確認中で未同梱。python3 build.py で生成すると動く）")
class TestLibJs(unittest.TestCase):
    def test_lib_js(self):
        r = subprocess.run(["node", str(kh.ROOT / "tests" / "lib_test.js")], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("lib_test OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
