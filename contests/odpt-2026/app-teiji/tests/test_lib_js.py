import shutil
import subprocess
import unittest

from helpers import APP


@unittest.skipUnless(shutil.which("node"), "node が無いのでJS純粋関数の試験をスキップ")
class TestLibJs(unittest.TestCase):
    def test_lib_js(self):
        r = subprocess.run(["node", str(APP / "tests" / "lib_test.js")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("lib_test OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
