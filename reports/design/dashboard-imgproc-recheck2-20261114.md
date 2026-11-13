# 新旧写真比較表示・再審査2（2026-11-14）

> 置き場所の注記：本来の報告先は worktree `.claude/worktrees/agent-a7be3a9d81cbbe041/reports/design/` だが、書き込みガード（guard_paths.py はセッションの作業ディレクトリ基準）が worktree 内への Write を拒否した。そのためこの本文は本体の reports/design/ に置いた。スクリーンショットとログは worktree の `reports/design/dashboard-imgproc-recheck2-20261114/` にある。本文中のリンクは worktree の同じ階層に置いたとき有効になる相対パス。参謀長側で worktree へコピーしてほしい。

**判定：重大0件／中0件／軽微1件。成功条件「重大0件」は達成。** 前回のR1［中］は解消、L1［軽微］も解消。軽微1件は今回追加された地図上の「写真の比較へ戻る」ボタンが背景地図の切替（淡色・標準・写真）を覆う問題（N1）。390pxの上下配置で補正ボタンや出典文が下がる点は確認した。目的達成は妨げないため指摘にはしない（下記「上下配置の押し下げ」）。審査者が実画面を見たレビューであり、初見ユーザー試験ではない。

対象：ブランチ `claude/engineer-dashboard-imgproc-fix-20261114`、コミット `4838b5e`。変更は `ChimeiCompare.tsx`（scroll-mt-40／md:scroll-mt-0）、`biz-idea/index.tsx`（#biz-map に scroll-mt と map-return ボタン）、`PhotoCompare.tsx`（並列を grid-cols-1、md以上で2列）。

座標は左上を(0,0)とするCSS px。PCは1280×765、スマホは390×844、DPR 1。

## 前回指摘の解消判定

| 前回 | 判定 | 実表示の根拠 |
|---|---|---|
| R1［中］スマホで原図・比較へ移動したとき固定ヘッダーに隠れる。原図側に戻る操作がない | **解消** | [原図へ移動後](dashboard-imgproc-recheck2-20261114/mobile-biz-to-map.png)：固定ヘッダーと手順バーの下端はy=146。地図はy=160〜481に全体が収まり、選択地点「ぬま田（架空）」(195,306)も見える。地図左上(8,168)〜(128,200)に「写真の比較へ戻る」が出る。[そのボタンを押した後](dashboard-imgproc-recheck2-20261114/mobile-biz-map-return.png)：比較コンテナ上端はy=160。黄枠A・白枠Bの案内(16,160)〜(374,262)、年代選択(168,259)、境界つまみ、写真(16,334)〜(374,692)が追加スクロールなしで同じ画面に入る。操作欄側の「写真の比較へ戻る」も同じ位置に戻る（[mobile-biz-panel-return](dashboard-imgproc-recheck2-20261114/mobile-biz-panel-return.png)、比較の上端はy=160）。 |
| L1［軽微］スマホで左右に並べると細部が小さい | **解消** | [並列・上](dashboard-imgproc-recheck2-20261114/mobile-biz-side-top.png)：写真は上下配置になり、各358px幅（前回は約177px角）。黄枠A(150,422)〜(241,500)が拡大され、建物・道路、「B」「s1（架空）」が読める。[並列・下](dashboard-imgproc-recheck2-20261114/mobile-biz-side-second.png)にキャプション「今（全国最新写真）」。盛土ウォッチ熱海市0001でも同じく358px幅で上下に並ぶ（[udc並列・上](dashboard-imgproc-recheck2-20261114/mobile-udc-side-top.png)／[下](dashboard-imgproc-recheck2-20261114/mobile-udc-side-second.png)）。 |

### PC幅で変化がないことの確認

- スワイプ・並列：[PC並列](dashboard-imgproc-recheck2-20261114/desktop-biz-side-top.png)は従来どおり左右2列（各189×205、(256,298)/(449,298)）。[盛土PC並列](dashboard-imgproc-recheck2-20261114/desktop-udc-side-top.png)も2列。[PC入口](dashboard-imgproc-recheck2-20261114/desktop-biz-entry.png)・[盛土PC入口](dashboard-imgproc-recheck2-20261114/desktop-udc-entry.png)のスワイプ位置も前回と同じ。
- 移動位置：PCは右側の地図が常に見えるため、ページのscrollYは0のまま。左パネル内で比較が上端(256,124)に来る（[PC戻る後](dashboard-imgproc-recheck2-20261114/desktop-biz-map-return.png)）。
- 唯一の変化は、原図表示中に地図左上へ「写真の比較へ戻る」が出ること。これはN1で扱う（[PC原図](dashboard-imgproc-recheck2-20261114/desktop-biz-to-map.png)の(678,73)〜(798,105)）。

### 上下配置の押し下げ（依頼の確認点。指摘なし）

- 並列にすると、比較枠の高さは358→756px（＋398px）になる。同じスクロール位置での「コントラスト補正」ボタンの上端は、スワイプ時のy=700から並列時のy=1098へ下がり、初期画面の外に出る（[並列・上](dashboard-imgproc-recheck2-20261114/mobile-biz-side-top.png)、`mobile-log.txt` の correction）。出典文はその直下に続く（[並列・下](dashboard-imgproc-recheck2-20261114/mobile-biz-side-second.png)の(16,420)〜(374,545)）。盛土も同様で、補正はy=947、陰影起伏はy=983。
- 見える範囲は146〜844の698pxで、2枚（756px）を同時に全部は見られない。ただし[並列・上](dashboard-imgproc-recheck2-20261114/mobile-biz-side-top.png)の状態で、昔の黄枠A(y≈422)と今の黄枠A(y≈803)は同時に見えるため、比べる対象は1画面で追える。補正・出典は補助情報で、初期表示はスワイプのまま。少しスクロールすれば届くため、目的達成の妨げにも迷いの原因にもならないと判断した。
- 任意の改善（指摘外）：上下配置のとき、2枚目の年代キャプション「今（全国最新写真）」は写真の下(16,358)にあり、2枚目の上部だけが見える位置では読めない。スマホでは写真左上の年代バッジ（スワイプと同じ黒地白字）にすると、どちらの写真か常に分かる。

## 新規指摘

### N1［軽微］原図表示中は「写真の比較へ戻る」ボタンが背景地図の切替を覆う（PC・スマホ共通）。PCでは同名ボタンが二重に並ぶ

**根拠**：
- 背景切替（淡色・標準・写真）は地図左上の絶対配置。PCでは(678,73,124×32)、スマホでは(8,211,124×32)にあり、原図を出す前は3ボタンとも押せる（[PC並列](dashboard-imgproc-recheck2-20261114/desktop-biz-side-top.png)の(680,75)）。
- 原図表示中は map-return（z-10、left-2 top-2）が同じ位置に重なる。elementFromPoint で調べると、両幅とも「淡色」「標準」「写真」の3つすべてが `map-return` に覆われる（`overlap-desktop-log.txt`／`overlap-mobile-log.txt` の ORIG 行）。[PC原図](dashboard-imgproc-recheck2-20261114/desktop-orig-map-topleft.png)と[スマホ原図](dashboard-imgproc-recheck2-20261114/mobile-biz-to-map.png)で、切替が見えないことを確認した。
- PCでは左パネルの「写真の比較へ戻る」(396,428)と地図上の同名ボタン(678,73)が同時に見える（[PC原図](dashboard-imgproc-recheck2-20261114/desktop-biz-to-map.png)）。

**観点**：導線（同じ機能の二重配置）、状態表示（操作が手がかりなく消える）。原図表示を消せば切替は戻り、比較・原図の確認自体は妨げないため軽微とする。

**要確認**：原図を「写真」背景に重ねて今の土地と見比べる使い方を想定しているなら、中に上げる。想定していない（原図表示中は背景を変える必要がない）なら軽微のまま。

**直し方の提案**：map-return を `md:hidden` にしてスマホだけに出す（PCの二重とPCでの被りを同時に解消）。スマホでは背景切替の下（例：top-12）か右下など、既存の操作と重ならない位置に置く。390pxで両方を押せることを確かめる。

## 審査条件・確認範囲

- worktree `/home/ubuntu/dev/2026/geo-campaign-2026/.claude/worktrees/agent-a7be3a9d81cbbe041` の contests/dashboard で `npx vite build --outDir <スクラッチ>` を実行した（リポジトリ内に成果物は出していない）。それを `python3 -m http.server 8871`（127.0.0.1）で配信し、審査後はそのプロセスだけを停止した。アプリの修正・コミット・push・外部POSTなし。
- Chrome headless（新規プロファイル）＋Node 22/CDP。クリックはCDPのマウス入力。スクリプトは `recheck2.mjs`（本審査）、`overlap.mjs`（N1・フォーカス）。座標ログは `mobile-log.txt`・`desktop-log.txt`・`overlap-*-log.txt`。保存したスクリーンショットは20枚。
- 地名：ぬま田（架空）、手順3。スワイプ／並列、補正の切替、原図表示→「地図の原図を見る」→地図上の戻る、操作欄の戻るを両幅で確認。盛土：熱海市0001、手順3でスワイプ／並列を両幅で確認。
- キーボード：Tabで map-return に到達できる。`:focus-visible` で3px実線のフォーカスリングと白の縁取りが出る（[PCフォーカス](dashboard-imgproc-recheck2-20261114/desktop-map-return-focus.png)の(678,73)）。
- 両アプリ・両幅でページ横スクロールなし（390pxでscrollWidth=390）。JavaScript例外・コンソールエラーなし。
- 描画上の留保：スマホの一部スクリーンショット（例：[mobile-biz-entry](dashboard-imgproc-recheck2-20261114/mobile-biz-entry.png)の地図部分）は地図キャンバスが白く写る。前回と同じヘッドレス（swiftshader）の描画現象で、移動後の画像では正常に描画されるため採点していない。盛土の「今」の写真が淡く見えるのは改修前からの表示で、今回の変更範囲外。
- 未確認：伊東市・熱海市0012の並列、タッチ実機でのジェスチャー、全要素のコントラスト比測定。

| 観点 | 結果 |
|---|---|
| 第一画面・文言 | 変化なし。スマホ原図往復後もA/Bの案内が読める（R1解消）。 |
| 導線 | 原図⇔比較を往復できる。PCで戻るボタンが二重（N1）。 |
| スクロール | スマホの移動先がヘッダー直下(y=160)に揃う。PCのscrollYは0のまま。 |
| 視覚階層・一貫性 | 並列の上下配置は両アプリ共通（共有コンポーネント）。 |
| 状態表示 | 原図表示中だけ戻るボタンが出る。背景切替が隠れる（N1）。 |
| アクセシビリティ | map-return はTabで届き、フォーカスリングが見える。高さ32pxは周囲のボタン（30px）と同程度。 |
| レスポンシブ | 390pxで横スクロールなし。並列写真は358px幅。 |
| データ・出典 | 架空表示・出典・加工の注記に変化なし。出典は並列時に約400px下がるが残る。 |

## 良い点（維持したい点）

1. スマホで原図・比較のどちらへ移動しても、移動先がヘッダー直下に揃う。案内・年代選択・写真をスクロールし直さずに読める。
2. 上下配置の並列では写真が約2倍の幅になり、黄枠Aの中の建物・道路が判別できる。初期表示はスワイプのままで、補助機能の位置も大きく崩れていない。
3. 新しい戻るボタンは原図表示中だけ出る。キーボードで届き、フォーカス表示もある。
