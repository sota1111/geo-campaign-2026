"""子連れお出かけ診断。既存アプリ（../app）の lifemap を import して再利用する（lifemap は変更しない）。"""
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent / "app"
if str(APP) not in sys.path:
    sys.path.append(str(APP))   # 末尾に足す（app/tests や app/build.py が、こちらの tests や build.py より先に見つからないように）
