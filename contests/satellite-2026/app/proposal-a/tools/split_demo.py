#!/usr/bin/env python3
"""build_data.py が出した（架空の空洞結果 sim_cavity・surveyed を含む）JSON を、
  1. 実データだけの data/toyonaka.json（sim_cavity・surveyed を持たない）
  2. 説明用デモ専用の data/demo_sim.json（架空。既定の画面は読み込まない）
に分ける。2026-11-21 の作り直しで、既存の data/toyonaka.json に対してもこの処理を行った。

usage: python3 -I tools/split_demo.py <in.json> <out_real.json> <out_demo.json>
"""
import json
import sys

NOTE = ('実データ（衛星: 国土地理院の干渉SAR成果／道路: OpenStreetMap／下水道台帳: 豊中市）を加工したもの。'
        '地中レーダの結果（空洞の有無）は含まない（利用者が CSV で入れる。説明用デモの架空の結果は data/demo_sim.json に分離）。'
        '道路形状は © OpenStreetMap contributors の派生データベースで、Open Database License (ODbL) で提供（https://www.openstreetmap.org/copyright）。'
        '下水道台帳は豊中市（CC BY 4.0、https://creativecommons.org/licenses/by/4.0/deed.ja）。衛星は 解析：国土地理院 原初データ所有：JAXA。')
DEMO_NOTE = ('【架空】説明用デモ専用。地中レーダの結果を乱数（seed 20261121）で作ったもの。実在の調査結果ではない。'
             '既定の画面では読み込まない。past=過去に調査済みとした区間（幹線全部と生活道路の約6%）、hit=空洞ありとした区間。')


def split(d):
    past = [s['id'] for s in d['segments'] if s.get('surveyed')]
    hit = [s['id'] for s in d['segments'] if s.get('sim_cavity')]
    for s in d['segments']:
        s.pop('surveyed', None)
        s.pop('sim_cavity', None)
    d['note'] = NOTE
    return d, {'note': DEMO_NOTE, 'seed': 20261121, 'past': past, 'hit': hit}


if __name__ == '__main__':
    src, out_real, out_demo = sys.argv[1:4]
    real, demo = split(json.load(open(src)))
    json.dump(real, open(out_real, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(demo, open(out_demo, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('past', len(demo['past']), 'hit', len(demo['hit']))
