"""tests 配下のモジュールを `import kh` のように読めるようにする（python3 -m unittest で実行できる）。"""
import sys
from pathlib import Path

HERE = str(Path(__file__).resolve().parent)
if HERE not in sys.path:
    sys.path.insert(0, HERE)
