# 憲兵 監査報告: イチBiz 不動産情報活用部門 新案 A4「同じ土地、四つの値段」 2026-11-21

監査者: 憲兵（修正はしていない。書き込みは本ファイルのみ）。
対象: ブランチ claude/engineer-ichibiz-2026-reinfolib-20261121（worktree .claude/worktrees/agent-adf884da2176b4851）の contests/ichibiz-2026/submission/realestate-a4/（title・problem・service・background・reinfolib）、check_limits_a4.py、app/realestate-a4/（README・web/lib.js・web/index.html・tools/fetch.mjs・web/data/fukuoka.json は git 履歴の検索で検査）。
根拠資料: contests/ichibiz-2026/brief.md、reports/intel/ichibiz-2026-20261109.md（必須項目・字数・生成AI条項・不動産部門の入力欄）、reports/intel/ichibiz-2026-multi-entry-20261113.md、reports/intel/ichibiz-2026-xct001-duplicates-20261121.md（worktree 側）、reports/audit/ichibiz-2026-realestate-rn1-20261113.md（過去の判定の基準）。

## 件数と結論
- 失格級: 1件（D1 本人欄の未記入 3か所）。
- 重大・要確認（提出前に総司令官の判断が要る）: 3件（G1〜G3）。
- 減点級: 3件（H1〜H3）。
- 軽微: 5件（m1〜m5）。
- 結論: 提出可能とは報告しない。D1 は総司令官（本人）が本人の文を書き、再監査するまで解消しない。
- 失格級があるため reports/escalations/ にも記録が必要。書き込みは hook により reports/audit/ に限られるため、転記は参謀長に依頼する（末尾）。

## 検査範囲と限界（正直に）
- Bash は tools/ と git 参照系だけで、`python3 contests/ichibiz-2026/check_limits_a4.py` は hook に拒否され実行できなかった。字数は、スクリプトの数え方（改行を除く全文字、【本人加筆】括弧書きを含む）に合わせた手計算（誤差は数字程度）。
- Grep が使えない。秘密情報と禁止語は `git log -G`（コミット済み内容。作業ツリーは clean）で形を検査した。fukuoka.json（約200k トークンの1行 JSON）は全文を読めず、ヘッダ値の有無を `-G` で確認した。
- 規約・要項の原文は取得できない。規約の記載は情報部報告（要約ツール経由）と lib.js の定数に依存する。
- app.js・style.css・tools/extract.mjs・tools/parcels.mjs・テストは読んでいない。テストの再実行・画面の実機確認もしていない。lib.js・index.html・fetch.mjs・README は全文を読んだ。

## 失格級

### D1 本人欄が未記入のまま（穴は3か所。background.md は全文が穴）
- 場所:
  1. submission/realestate-a4/problem.md 1行目末尾「【本人加筆（150字以内）: 相続・売却・固定資産税の通知書などで価格の違いに戸惑った場面…】」
  2. submission/realestate-a4/service.md 2行目「【本人加筆（150字以内）: 着想の核…】」
  3. submission/realestate-a4/background.md 全文（「【本人加筆（本人が書く。300字以内）…】」の1行のみ。必須項目の背景・きっかけ300字が実質空）
- 根拠: reports/intel/ichibiz-2026-20261109.md「応募上の注意」（生成AIは補助利用なら可。応募者の独自性が認められないものは応募を控える）と「入力項目」（背景・きっかけ300字は全部門共通）。同種を失格級とした前例 reports/audit/ichibiz-2026-realestate-rn1-20261113.md D1。
- 事実: このまま送信すると、指示文（プレースホルダ）を提出し、必須項目の背景が内容なしになる。check_limits_a4.py は指示文も字数に数えるため「OK」と出し、この穴を検出しない（空欄判定は0字のみ）。
- 追加: 体験が無い場合の扱い（取材を「聞いた話」として書く等）は background の指示文にあるが、本人の体験・取材の有無は未確認。
- 解消の条件: 総司令官が3か所を書き、`grep -rn "【" contests/ichibiz-2026/submission/realestate-a4/*.md` で残りが無いことを確認。その後 check_limits_a4.py と憲兵の再監査。

## 重大・要確認

### G1 同梱データ（web/data/fukuoka.json）の二次配布の条文が未確認
- 根拠: app/realestate-a4/README「同梱 JSON の二次配布の明示条文は未確認」、reports/audit/ichibiz-2026-realestate-rn1-20261113.md G2（同種の論点。API利用規約の「自由に無償で利用」が再配布を含むかは条文から直ちには言えない）。
- 事実: 福岡県の標準地879地点分（地価公示・鑑定評価書情報の価格・位置・所在）を公開ディレクトリ web/ に同梱し、静的ファイルとして配る設計。参謀長判断（総司令官の委任）で同梱済み。禁止の条項は確認できた範囲に無い（許可の確認が無いだけ）。
- 失格級にしなかった理由: 禁止の確認がない。提出文にデモの URL は無く、提出するのは文章と任意の補足資料。公開（デプロイ）しなければ再配布は起きない。画面側は出典・加工・クレジット・責任を表示している（下表）。
- 要求（総司令官の判断）: 試作を公開・審査員へ共有・補足資料に載せる場合は、先に利用条件を確認する（ライブラリの問い合わせ窓口 https://www.reinfolib.mlit.go.jp/help/contact/。送信は総司令官）。確認が取れるまで公開しない。要確認。

### G2 提出文の「公示価格」は XPT002 の当年価格が判定価格に当たる確証がない
- 根拠: reports/intel/ichibiz-2026-xct001-duplicates-20261121.md F2（公示価格は委員会判定の1つの価格）、F5・Q5（XPT002 の当年価格が判定価格に当たると明記した公式の文は確認できていない。有力な対応）。
- 事実: README と lib.js の注釈は出典を「XPT002 の当年価格」と書き、README は未確認を明記している。一方、提出文 service.md は「公示価格は1地点に1つ」と言い切り、reinfolib.md は「当年価格を…公示価格として出す」と書く。未確認の旨は提出文（審査員が読む部分）に無い。
- 影響: 審査（実現可能性・正確さ）で「公示価格」の正誤を問われうる。画面の見出し「公示価格」が、官報の公示価格と異なる値なら誤表示になる。832地点の標準地番号の形が XPT002 と一致している点は整合の傍証にとどまる。
- 要求: 総司令官が、窓口への確認か、提出文を「地価公示のポイントAPIの当年価格（公示価格に当たると見ている）」と改める（修正は工兵）かを判断。要確認。

### G3 提出文が「鑑定評価書の記録ごとに値がある」「試算価格」と断定している
- 根拠: reports/intel/ichibiz-2026-xct001-duplicates-20261121.md Q1・Q2（「2件＝評価員2人分の評価書」は公式に明記なし。比準価格・収益価格が評価書ごとの値かは未確認）。
- 場所: service.md 1行目「比準価格と収益価格は鑑定評価員が求めた試算価格で、鑑定評価書の記録ごとに値があり、2件の値が違えば並べて示す。」、web/lib.js の PRICES 注釈（「鑑定評価書の記録ごとに値があります」）。
- 事実: 「試算価格」の定義は制度説明（001208844.pdf p.2）に根拠がある。「記録ごとに値」は、2件のうち値が違う観測（README）に基づく記述で、APIの仕様としての裏付けはない。画面側は「2人分に当たるとは断定しない」と配慮している（lib.js RECORDS_NOTE）が、service.md の文はそこまで抑えていない。
- 影響: 減点級に近いが、事実の断定のため重大側に置いた。判断が割れる箇所（要確認）。

## 減点級

### H1 生成AI条項: AI文の比率（解釈が割れる。要確認）
- 根拠: reports/intel/ichibiz-2026-20261109.md（補助利用は可、出力をそのまま用いたもの・独自性が認められないものは控える）、reports/escalations/20261109-ichibiz-genai-clause.md、前例 reports/audit/ichibiz-2026-realestate-rn1-20261113.md H1。
- 事実: 本人加筆の枠は problem 150字（約400字中）、service 150字（700字中）、background 全文。service は本人の文が約2割強で、残りは AI の下書き。reinfolib 欄は全文が下書き（技術的な説明のため独自性より正確性）。何割なら独自性ありかの公式基準は無い。
- 要求: 本人加筆の後、AI文の語彙・文末を本人の調子に整える（工程が personalize 系の手順にある場合はそれに従う）。基準が無いので総司令官が判断。

### H2 service.md の字数の余白が少ない（本人加筆後に超過する恐れ）
- 根拠: brief.md・intel（service は700字）。
- 事実: 手計算で現状 約594字（指示文87字を含む）。本人の文が150字ちょうどなら 約657字（余り約43字）。指示文の上限（150字以内）を守れば収まるが、言い換えの余地は小さい。problem は約254字（本人加筆後 約331字、余裕あり）。title 約41/50。
- 要求: 本人加筆後に check_limits_a4.py を実行（憲兵の再監査でも実行を試みる）。

### H3 reinfolib 欄の字数上限が要項で未確定
- 根拠: reports/intel/ichibiz-2026-20261109.md 確定事項1・要確認3（「字数は記載なし（未確認）」）。check_limits_a4.py の400は目安（スクリプト冒頭の記載）。registry.json・brief.md に reinfolib 欄が無い（intel の registry 更新提案は未適用）。
- 事実: 手計算で約294字。400字より小さい上限（例: 300）だと余白が薄い。必須データ要件（不動産情報ライブラリの活用）自体は満たす。
- 要求: 総司令官が応募フォーム（https://g-idea.go.jp/2026/entry/ の入力画面）で上限を確認。registry.json への追記は総司令官の承認が必要。

## 軽微
- m1 件数の一致確認: 同梱 fukuoka.json のヘッダに `"matched":832`、koji の `"points":940`、fill に 832 と 341 が入っていることを確認（`git log -G`）。879地点・469・452・住宅地627・商業地252・タイル154 は、構造上README・提出文の数と整合するはずだが、1行 JSON の全文を読めず個別には照合していない（要検算。`python3 tools/` 経由の検算手段が無い）。提出文の数字は「作成者集計」と明記され、出典は README の「状態」節にある。
- m2 提出文 reinfolib.md の「タイル154枚」は README では「約154タイル」。実取得の枚数との一致は上記のとおり未照合。
- m3 fetch.mjs は環境変数 REINFOLIB_BASE_URL で送信先を差し替えられ、その場合キーのヘッダがそのホストに送られる。通常は既定の公式 URL。運用上の注意（実害なし）。
- m4 現行案 realestate・RN1 と合わせ、同一部門に3案目（m6 の類似論点）。同一部門への複数件・件数上限は要項に「明記なし」（reports/intel/ichibiz-2026-multi-entry-20261113.md）。README は「どれを出すかは総司令官が決める」としており、複数を出す場合は類似による互いの不利（要項 p.7、推測）と事務局確認が要る（要確認）。
- m5 index.html は「住所検索で国土地理院に検索語が届く」旨を明記している。README の「GET のみ・キー不要」と整合。外部への POST は無い。

## SOP チェックリストの結果
| 項目 | 結果 |
|---|---|
| field_limits（字数） | title約41/50、problem約254/400、service約594/700、background指示文のみ、reinfolib約294/（400は目安）。いずれも手計算で上限内。本人加筆後は service が約657でぎりぎり（H2）。スクリプト未実行 |
| 必須項目・必須データ | reinfolib 欄あり、不動産情報ライブラリの2API（XCT001・XPT002）を使用。要件は満たす。本人欄が未記入（D1） |
| 締切の時刻 | 12/10 20:00。brief.md と一致 |
| UDC 等の公開前提 | 該当なし |
| APIキー・個人情報・社外秘 | 検出なし。`git log -G"[0-9a-fA-F]{32,}"` を app の tools・tests・README・lib.js・index.html・submission・check_limits_a4.py と web/data について実行し、いずれも0件。fetch.mjs はキーを環境変数 REINFOLIB_API_KEY からのみ読み、ファイル・ログ・例外に出さず、生の応答も保存しない（全文確認）。README の実行例は `--env-file=.env` を指すだけで値は無い。未検査: 実際のキー値との照合、メールアドレスの検索 |
| 同一コンペへの類似作品の重複 | m4（要確認）。複数応募自体は可（intel） |
| 数値・効果の出典 | 件数は同梱データ由来で「作成者集計」と明記。効果の主張なし。「払い手は想定、根拠数値は無い」と正直に書いている。G2・G3 の断定は未確認項目 |
| API利用規約 第7条クレジット | 適合。lib.js の CREDIT がRN1と同じ規約文言。フッター（index.html）に表示 |
| 出典・加工の明記（PDL1.0） | 適合。ATTRIBUTION・PROCESSED をフッターに表示、地図の attr にも「不動産情報ライブラリ（国土交通省）を加工」 |
| 国の監修でない旨・作成者の責任 | 適合。冒頭の注意書きとフッターの RESPONSIBILITY に明記。提出文 reinfolib.md にも責任の記載あり |
| サービス名にライブラリ名を使わない | 適合。title.md・見出し・index.html の title に無い（データ名として本文・出典に出るのみ） |
| 「査定」「適正価格」 | 適合。`git log -G` で web/ と submission/ に0件（README は禁止の説明として載るだけ） |
| 同梱データの二次配布 | G1（要確認。公開しなければ未発生） |
| 生成AI条項 | H1（要確認） |

## 提出前に総司令官がすべきこと
1. D1: 本人の文を3か所に書く（background 300字、problem 150字以内、service 150字以内）。体験が無ければ取材1件、または別案へ。書いた後に check_limits_a4.py と `grep -rn "【" …/submission/realestate-a4/*.md`、憲兵の再監査。
2. G2・G3: 「公示価格」「記録ごとの値」の表現を、窓口確認か控えめな書き方（修正は工兵）で決める。
3. G1: 同梱データを公開・共有する前に利用条件を確認する（送信は総司令官）。
4. H3: 応募フォームで reinfolib 欄の字数上限を確認する。
5. H1・m4: 生成AI条項の許容範囲と、同一部門の複数案（現行・RN1・A4）をどう出すかを決める。

## 備考・escalations への転記依頼
- 修正は一切していない。書き込みは本ファイルのみ。
- 失格級（D1）は reports/escalations/ にも記録が必要。記録先の提案: reports/escalations/20261121-ichibiz-realestate-a4-honnin.md（参謀長が転記する）。
