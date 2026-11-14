"""人口メッシュ（0〜14歳を含む）の読み込み。

既存アプリの lifemap.sources.read_mesh_population は 総数・65歳以上だけを返すので、
同じ e-Stat 地域メッシュ統計(T001102)の zip から、総数と 0〜14歳人口 を読む（列は T001102001 と T001102004）。
秘匿（'*'）は 0 として扱う。250m メッシュを 500m メッシュ（先頭9桁）に集約する。
"""
import csv
import io
import zipfile

COL_TOTAL = 4    # T001102001 人口（総数）
COL_AGE0_14 = 7  # T001102004 ０～１４歳人口 総数


def read_mesh_population_0_14(zip_path):
    """-> {9桁コード: [人口総数, 0〜14歳人口]}"""
    out = {}
    with zipfile.ZipFile(zip_path) as zf:
        name = zf.namelist()[0]
        rd = csv.reader(io.TextIOWrapper(zf.open(name), "cp932", newline=""))
        head = next(rd)
        label = next(rd)
        assert head[COL_TOTAL] == "T001102001" and head[COL_AGE0_14] == "T001102004", head[:9]
        assert "０～１４歳" in label[COL_AGE0_14], label[COL_AGE0_14]
        for row in rd:
            key = row[0]
            if len(key) != 10:
                continue
            cur = out.setdefault(key[:9], [0, 0])
            if row[COL_TOTAL].isdigit():
                cur[0] += int(row[COL_TOTAL])
            if len(row) > COL_AGE0_14 and row[COL_AGE0_14].isdigit():
                cur[1] += int(row[COL_AGE0_14])
    return out
