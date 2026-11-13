# 新旧写真比較表示・再審査3（N1のみ・2026-11-14）

**判定：重大0件／中0件／軽微0件。前回のN1［軽微］は解消。** 新しい重大・中の指摘もない。審査者が実際の画面を見て確認した結果で、初見ユーザー試験ではない。

対象：worktree `.claude/worktrees/agent-a7be3a9d81cbbe041`、ブランチ `claude/engineer-dashboard-imgproc-fix-20261114`、コミット `344ad53`。変更は `contests/dashboard/src/apps/biz-idea/index.tsx` の map-return のクラスだけ（`left-2 top-2` を `bottom-8 left-2 md:hidden` に変更）。

座標は左上を(0,0)とするCSS px（x, y, 幅, 高さ）。スマホは390×844、PCは1280×765、DPR 1。地名は「ぬま田（架空）」で手順3を開き、「上（右）の地図で原図を見る」→「地図の原図を見る」と押して原図を表示した。

## N1 の解消判定

| 確認項目 | 結果 | 根拠 |
|---|---|---|
| 390px：原図表示中に map-return が他の地図部品と重ならない | **満たす** | [mobile-orig-map.png](dashboard-imgproc-recheck3-20261114/mobile-orig-map.png)。map-return は(8,416,120,32)で地図の左下にある。背景切替(8,168,124,32)、ズーム(351,170,29,58)、縮尺(10,448,76,22)、出典文のリンク(114,452,120,14)のどれとも矩形が重ならない（縮尺の上端と map-return の下端はどちらもy=448で、接してはいるが重なってはいない）。`mobile-log.txt` の ORIG 行では、各部品の中心で elementFromPoint を調べた結果がすべて `reachable`、map-return の中心も自分自身に当たる（mrHit=true）。 |
| 390px：原図表示中に背景切替を押せる | **満たす** | 原図表示中に「写真」(112,184)をマウス入力で押した。押下状態は「淡色:false 標準:false 写真:true」になり、出典の表示も「国土地理院タイル（写真）」に変わった（`mobile-log.txt` の BGSTATE・AFTER_BG_PHOTO 行）。[mobile-orig-bg-photo.png](dashboard-imgproc-recheck3-20261114/mobile-orig-bg-photo.png)では、写真の背景の上で map-return と縮尺がそのまま読める。 |
| 390px：map-return を押すと比較へ戻る | **満たす** | map-return の中心(68,432)をマウス入力で押した。押した後、比較コンテナの上端は固定ヘッダーの下端(y=146)のすぐ下、y=160に来る。ページのscrollYは43から438に変わる。[mobile-after-return.png](dashboard-imgproc-recheck3-20261114/mobile-after-return.png)では、案内（黄枠A・白枠B）、年代の選択、スワイプ写真が1画面に収まっている。 |
| 1280×765：map-return が出ない | **満たす** | 原図表示中でも map-return は `display:none`（矩形は0×0）。[desktop-orig-map.png](dashboard-imgproc-recheck3-20261114/desktop-orig-map.png)で地図上に戻るボタンがないことを確認した。前回指摘した「同じ名前のボタンが二重に並ぶ」状態は解消し、戻る操作は左パネルの「写真の比較へ戻る」だけになった。 |
| 1280×765：背景切替を押せる | **満たす** | 原図表示中、背景切替(678,73,124,32)の3つのボタンはすべて `reachable`。「写真」(782,89)を押すと、出典の表示が「国土地理院タイル（写真）」に変わる（`desktop-log.txt` の AFTER_BG_PHOTO 行、[desktop-orig-bg-photo.png](dashboard-imgproc-recheck3-20261114/desktop-orig-bg-photo.png)）。 |

## 新規指摘

なし。

観察（指摘はしない）：390pxでは、map-return の下端が縮尺「300 m」の上端にすき間なく接している。縮尺は押せる部品ではなく、文字も両方とも読めるため、目的の達成も見た目の読み取りも妨げない。気になる場合は `bottom-10` などで4〜8pxのすき間を空ければよい。

## 審査条件・確認範囲

- worktree の contests/dashboard で `npx vite build --outDir <スクラッチ>` を実行した（リポジトリ内には成果物を出していない）。それを `python3 -m http.server 8873`（127.0.0.1）で配信し、審査後はそのプロセスだけを止めた。アプリの修正・コミット・push・外部へのPOSTはしていない。
- Chrome headless（新規プロファイル）とNode 22のCDPで操作し、クリックはCDPのマウス入力で行った。スクリプトは [recheck3.mjs](dashboard-imgproc-recheck3-20261114/recheck3.mjs)、座標の記録は `mobile-log.txt`・`desktop-log.txt`。スクリーンショットは5枚。
- 両方の幅でJavaScriptの例外・コンソールエラーはなかった。390pxでscrollWidth=390のため横スクロールはない。PCのscrollWidth=1265は縦スクロールバーの分で、横スクロールではない。
- 確認していないこと：タッチの実機での操作。盛土ウォッチ（udc）は map-return を持たないため対象外。Tabによるフォーカス表示は、クラス変更の影響を受けない（`md:hidden` 以外は同じ）ため、前回の確認結果を引き継いだ。

## 良い点（残してほしい点）

1. スマホでは、戻るボタンを地図の左下へ移したことで、背景切替・ズーム・出典のどれとも重ならない。原図を写真の背景に重ねて見比べる使い方もできるようになった。
2. PCでは地図上のボタンを出さないため、戻る操作が左パネルの1か所にまとまり、ボタンの二重配置がなくなった。
3. スマホで戻った後の位置は前回と同じくヘッダーの直下（y=160）に揃い、案内と写真をスクロールし直さずに読める。
