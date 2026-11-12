"""合成データでの遅れ推定の誤差を測る（実データでの精度ではない）。

    cd app-teiji && python3 tests/measure_synthetic_error.py

合成の走行（一定速度＋各停留所での停車 0〜45 秒＋ランダムな遅れ）から観測を作り、delay.estimate_trip で推定して、
「本当の発車時刻」との差（秒）を集める。路線の形・GPS 誤差・観測間隔を変えて、誤差の中央値・90 パーセンタイル・
推定できた割合を表にする。乱数は固定（再現できる）。バスの挙動は単純化してあり、実データの誤差の保証にはならない。
"""
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import BASE, DAY  # noqa: E402
from test_aggressor_teiji import ll, path_schedule  # noqa: E402
from teiji import delay  # noqa: E402

SHAPES = {
    "直線（6停留所・間隔1km）": ([(i * 1000, 0) for i in range(6)], ["S0", "S1", "S2", "S3", "S4", "S5"]),
    "ループ線（600m四方）": ([(0, 0), (600, 0), (600, 600), (0, 600), (0, 0)], ["A", "B", "C", "D", "A"]),
    "往復線（道の両側12m）": ([(0, 0), (400, 0), (800, 0), (1200, 0), (800, 12), (400, 12), (0, 12)], ["A", "B", "C", "D", "C2", "B2", "A2"]),
}
RUN = 180
SPEED_NOTE = "停留所間 180 秒の一定速度"


def simulate(pts, rnd, noise, every):
    """戻り値: (観測 [(epoch, lat, lon)], 本当の発車時刻 [停留所ごと。終点は到着], 遅れの基準値)。"""
    d0 = rnd.uniform(-120, 360)
    dwell = [0.0] + [rnd.choice([0, 0, 15, 30, 45]) for _ in pts[1:-1]] + [0.0]
    t_arr, t_dep, t = [], [], 8 * 3600 + d0
    for i in range(len(pts)):
        t_arr.append(t)
        t += dwell[i]
        t_dep.append(t)
        t += RUN
    obs = []
    # 始発では 0〜5 分の待機を観測する
    wait = rnd.choice([0, 120, 300])
    tt = t_dep[0] - wait
    while tt <= t_arr[-1]:
        # tt での位置
        for i in range(len(pts) - 1):
            if tt < t_dep[i]:
                x, y = pts[i]
                break
            if tt < t_arr[i + 1]:
                u = (tt - t_dep[i]) / RUN
                x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u
                y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u
                break
        else:
            x, y = pts[-1]
        if tt < t_dep[0]:
            x, y = pts[0]
        obs.append((BASE + tt,) + ll(x + rnd.gauss(0, noise), y + rnd.gauss(0, noise)))
        tt += every
    truth = [t_arr[-1] if i == len(pts) - 1 else t_dep[i] for i in range(len(pts))]
    return obs, truth


def main():
    print(f"合成データでの値（{SPEED_NOTE}、停車 0〜45 秒、始発の待機 0〜5 分、各条件 100 走行、乱数固定）")
    print("| 路線の形 | GPS誤差σ | 観測間隔 | 推定できた停留所 | 誤差の中央値(秒) | 誤差の90%点(秒) | 最大(秒) |")
    print("|---|---|---|---|---|---|---|")
    for name, (pts, ids) in SHAPES.items():
        sched = path_schedule(pts, ids, run=RUN)
        trip = sched["trips"]["T1"]
        for noise in (0, 5, 10):
            for every in (30, 60):
                rnd = random.Random(1)
                errs, got, tot = [], 0, 0
                for _ in range(100):
                    obs, truth = simulate(pts, rnd, noise, every)
                    out = delay.estimate_trip(trip, sched["stops"], DAY, obs)
                    tot += len(pts)
                    got += len(out)
                    # 停留所 i の推定の誤差 = 推定した遅れ - 本当の遅れ（本当の遅れ = 本当の時刻 - 時刻表）
                    for e in out:
                        errs.append(abs(e["delay_s"] - (truth[e["pos"]] - (e["sched"] - BASE))))
                errs.sort()
                p90 = errs[int(len(errs) * 0.9)] if errs else float("nan")
                print(f"| {name} | {noise}m | {every}秒 | {got}/{tot} ({100 * got / tot:.0f}%) | {statistics.median(errs):.1f} | {p90:.1f} | {errs[-1]:.0f} |")


if __name__ == "__main__":
    main()
