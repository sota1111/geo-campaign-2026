import os
import shutil
import subprocess
import unittest

import helpers


@unittest.skipUnless(shutil.which("node"), "node が無い")
class LibJsTest(unittest.TestCase):
    def test_lib_js(self):
        r = subprocess.run(["node", os.path.join(helpers.APP, "tests", "lib_test.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("OK", r.stdout)

    def test_app_js_syntax(self):
        r = subprocess.run(["node", "--check", os.path.join(helpers.APP, "web", "app.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
