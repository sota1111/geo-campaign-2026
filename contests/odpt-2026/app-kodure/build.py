#!/usr/bin/env python3
"""前処理の入口。python3 build.py [--today YYYY-MM-DD] [--workers N]
既存アプリ（../app）の lifemap を import して使う。"""
from kodure.build import main

if __name__ == "__main__":
    main()
