# UDC2026 作品② アプリ型 対象自治体候補の事実整理（取得日 2026-11-09）

対象: contests/udc-2026/submission/entry-2-idea.md「みんなの盛土ウォッチ」。選定はしない。事実と出典のみ。推測は「未確認」「推測」と明記。
候補の起点: 盛土通報窓口を公式に案内している県・市（静岡県「盛り土110番」ほか）。

## 1. 候補×条件の表

| 条件 | 熱海市（静岡県） | 富士市（静岡県） | 静岡市（政令市） | 松江市（島根県。中核市） |
|---|---|---|---|---|
| A56 2025年度版（2025-07-18時点）整備 | 県単位ファイルは掲載（静岡 A56-25_22）[A56]。市単位の整備有無は**未確認**（整備済み市区町村一覧 A56_datalist_R7.xlsx は取得したがバイナリで読めず） | 同左（未確認） | 同左（未確認）。参考: 市全域が規制区域に指定（2025-05-26運用開始）[SZC] | 島根県単位ファイルは掲載（A56-25_32）[A56]。市単位は**未確認**。参考: 松江市は県の規制区域の対象外で、市が独自に規制[SHI-R] |
| 規制区域の指定（自治体公式、A56とは別） | 静岡県が県内全域（静岡市・浜松市除く）を指定。熱海市は東部の対象市に掲載。指定日 2025-05-26 [SZ-R] | 同左（東部の対象市に掲載）[SZ-R] | 市全域が宅地造成等工事規制区域または特定盛土等規制区域 [SZC] | 松江市独自（内容未確認） |
| A54 大規模盛土造成地（2023年版、基準日2023-03-31） | 県単位ファイルは全47都道府県分あり。市単位の収録は**未確認**（A54ページに市区町村別一覧なし）[A54]。参考: 熱海市は市内14か所確認、位置は県サイトで公表と市が記載 [ATAMI] | 県単位ファイルあり、市単位収録は未確認。参考: 市が「大規模盛土造成地マップ」ページを公開 [FUJI] | 同左（未確認）。参考: 市が「大規模盛土造成地マップ」ページを公開 [SZC-MAP] | 同左（未確認）。参考: 市が大規模盛土造成地の概要PDFを公開（本文はPDF圧縮のため読めず、内容未確認）[MATSUE] |
| A33 の県の利用条件（2025年度版ページ） | 静岡県: オープンデータ（商用・再配布可）。個別条件は A33_permision_R7.xlsx に記載とされるが読めず**未確認** [A33] | 同左 | 同左 | 島根県: ページ上のオープンデータ区分（41県）に掲載 [A33]。個別条件は未確認 |
| 通報・相談窓口の公式案内 | 静岡県「盛り土110番」: 電話 054-252-9000、Webフォーム（e-tumo）https://apply.e-tumo.jp/pref-shizuoka-u/offer/offerList_detail?tempSeq=16589 。メールは「このページの問い合わせ先」欄のみで通報用か不明 [SZ-110]。熱海市自体の通報窓口は**未確認**（検索で見つからず） | 同左（県窓口） | 市ページに「盛土110番」の見出しあり。ただし受付は電話 054-221-1591（都市局都市計画部土地政策課盛土対策係）の問い合わせ先のみ。専用フォーム・メールの記載なし [SZC] | 島根県「盛土110番」: 電話 0852-22-6533、メール toshikei@pref.shimane.lg.jp、Webフォーム https://ttzk.graffer.jp/pref-shimane/smart-apply/surveys-alias/shimanemorido110ban 。ただし県の窓口が松江市内を対象とするかは**未確認**（市独自の通報窓口も未確認）[SHI-110] |
| 年代別写真の被覆 | 下記 §2 | 同左 | 同左 | 同左 |

補足（窓口の矛盾）: 静岡県盛土対策課の電話は掲載ページにより 054-221-2137（ページ1083754）と 054-221-2264（ページ1068121）の2通り。通報専用は 054-252-9000 [SZ-110][SZ-POL]。どちらが最新かは**要確認**。

## 2. 地理院タイル 年代別写真の被覆
- 1961〜1969年（ort_old10）、1974〜1978年（gazo1）とも、タイル一覧ページ上でズーム 10〜17。被覆範囲の欄は「明記なし」（限定地域と書かれている年代〔1936〜42頃: 東京23区・大阪周辺、1928頃: 大阪市域、簡易空中写真2004〜: 整備範囲のみ〕とは異なり、範囲限定の注記がない）[GSI-LIST]。
- 1974〜1978年: 検索結果で、国土画像情報第1期は「ほぼ日本全国について撮影」と読める記載あり（出典の一次ページ未確認。検索要約のみ）。
- 1961〜1964年の面的表示を追加したとの地理院発表はあるが、対象範囲（全国か一部か）の記載なし [GSI-NEW]。
- 個別の候補4市での被覆の有無は、公式情報では**未確認**（地図で実際に表示して確かめる必要がある。取得手段が無いため未実施）。
- 全国最新写真（seamlessphoto）一部に GRUS画像（© Axelspace）を含み、該当タイルでは明示が必要 [GSI-LIST]。

## 3. Sentinel-2 のキー・アカウント不要・無償のタイル配信
- あり（条件付き）: EOX「Sentinel-2 cloudless」の WMTS https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml 、WMS https://tiles.maps.eox.at/map?service=WMS&request=GetCapabilities 。ページに "Feel free to use the provided service endpoints" とあり、キー・トークンの記載は無い（キー不要と読めるが明示はなし）[EOX-P]。
- ライセンス: 2018〜2025年版は CC BY-NC-SA 4.0（非営利に限り無償）、2016年版は CC BY 4.0、2017年版は記載なし [EOX-P]。商用利用は EOX の別ライセンス（EOX Commercial Attribution-RestrictedUse 1.2）が必要 [EOX-L]。
- 出典表記の指定: 「EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data "year")」。地図上に表示、不可ならクレジット等に記載 [EOX-L]。
- 未確認: UDC作品が「非営利」に当たるか（作品は公開、個人応募。審査や賞金の扱いとの関係は未確認）。年別レイヤ名とタイルURLは Capabilities を取得していないため未確認。Copernicus Data Space のタイル配信（アカウント要否）は未確認。
- 上記以外の「キー不要・無償・商用可」の配信は、今回の調査では確認できず（なし／未確認）。

## 4. 出典表記・利用条件
- 地理院タイル: 出典に「国土地理院」または「地理院タイル」等と記載し、タイル一覧ページへのリンクを付ける [GSI-LIST][GSI-DEV]。承認申請: 基本測量成果でも、Webサイト・アプリがタイルをリアルタイムに読み込む場合は申請不要、出典表記で足りるとある。カテゴリ「その他」のタイルは備考・他機関条件の確認が必要 [GSI-DEV]。商用可否はページ上で明示なし（国土地理院コンテンツ利用規約を参照との案内）。加工した場合は加工した旨を出典とは別に記載。国土地理院が作成したかのように公表することは禁止 [GSI-TOS]。ページ後半（18万字中10万字以降）は未読。
- 国土数値情報 A54（2023年版）: CC BY 4.0。出典・加工: 国土交通省が地方公共団体データを編集、図形エラー修正。注意: 直ちに危険を示すものではない、全てを抽出していない、宅建業法の重要事項説明等の根拠に使えない [A54]。
- A56（2025年度版）: CC BY 4.0、利用規約への同意が必要。概略位置で法的図書でなく、申請資料や重要事項説明の根拠に使えない。規制区域を改変する加工・編集・再配布は禁止と記載。原典: 地方公共団体作成データ（国交省都市局が2024〜2025年度に収集）[A56]。Webアプリに表示する際の出典文言の指定は無し。「改変する加工・編集・再配布の禁止」の範囲（図としての重ね表示が含まれるか）は**未確認**。
- A33（2025年度版）: 41県オープンデータ（商用・再配布可）、6県（神奈川・京都・和歌山・広島・長崎・鳥取）は条件付き公開。個別条件は xlsx に記載とあり未確認 [A33]。
- 注意（要確認）: 旧ページ（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33.html、平成25〜30年版）は神奈川をオープン、兵庫を条件付きと記載し、2025年度版ページ（神奈川は条件付き、兵庫はオープン）と食い違う。年度版ごとに条件が違う。2025年度版の方が新しいが、どちらを採るかは判断せず併記する。

## 5. 未確認事項
1. A56・A54・A33の市区町村別整備状況: 整備済み市区町村一覧（A56_datalist_R7.xlsx）と A33_permision_R7.xlsx を取得したが、本環境ではバイナリを解析できず内容を読めなかった。保存先: /home/ubuntu/.claude/projects/-home-ubuntu-dev-2026-geo-campaign-2026/55c8f5f8-f372-4185-a15b-b5ef33eb415a/tool-results/webfetch-1794233562050-jt3729.xlsx（A56）、同 webfetch-1794233562815-ln59kk.xlsx（A33）。Excelで開けば確認可能。A54 は市区町村別の一覧自体が無く、GMLの属性（市区町村コード）で確認するしかない。
2. 熱海市・富士市の市としての通報窓口、静岡市の専用フォーム・メールの有無。
3. 松江市独自の規制区域・通報窓口、県窓口が松江市内を受け付けるか。
4. 候補4市での年代別写真の実際の被覆。
5. EOX 2017年版ライセンス、非営利の範囲、キー不要の明示。
6. 静岡県盛土対策課の電話番号の矛盾（2137／2264）。
7. 三重県・福島県も盛土110番を持つ。三重県は Webフォームあり（通報専用の電話・メールは記載なし）、規制区域の範囲は未確認。福島県は本文未取得。候補表には入れていない。
8. 松江市大規模盛土造成地PDFの本文（バイナリのため未読）。

## 6. registry更新提案
- 現時点でなし。なお entry-2-idea.md 内の「A33（一部制限。都道府県ごとの利用条件を確認）」「A56 の整備済み市区町村は一覧で確認」は、今回も市区町村別の確認が完了していない点で未達。

## 7. 出典一覧（すべて取得日 2026-11-09）
- [A56] https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A56-2025.html 、一覧 https://nlftp.mlit.go.jp/ksj/gml/codelist/A56_datalist_R7.xlsx
- [A54] https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A54-2023.html
- [A33] https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33-2025.html 、条件表 https://nlftp.mlit.go.jp/ksj/gml/codelist/A33_permision_R7.xlsx 、旧版 https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33.html
- [SZ-110] 静岡県 盛り土110番 https://www.pref.shizuoka.jp/machizukuri/tochiriyou/1041004/1043397.html
- [SZ-POL] https://www.pref.shizuoka.jp/machizukuri/tochiriyou/1041004/1083754.html 、 https://www.pref.shizuoka.jp/machizukuri/tochiriyou/1041004/1068121.html
- [SZ-R] 静岡県 規制区域 https://www.pref.shizuoka.jp/machizukuri/tochiriyou/1041004/1064870.html
- [SZC] 静岡市 盛土規制法 https://www.city.shizuoka.lg.jp/s9465/s012533.html
- [SZC-MAP] https://www.city.shizuoka.lg.jp/s9465/s007746.html
- [FUJI] https://www.city.fuji.shizuoka.jp/machi/c1801/fmervo000001harh.html （検索結果のタイトルのみ。本文未取得）
- [ATAMI] https://www.city.atami.lg.jp/shisei/machidukuri/1013059.html （検索結果要約のみ。本文未取得）
- [SHI-110] 島根県 盛土110番 https://www.pref.shimane.lg.jp/infra/toshi/bosai/moridokisei/morido110bann.html
- [SHI-R] 島根県 盛土規制 https://www.pref.shimane.lg.jp/infra/toshi/bosai/moridokisei/ （検索結果要約。松江市を除く旨）
- [MATSUE] https://www.city.matsue.lg.jp/material/files/group/91/daikibomoridozouseichi_gaiyou.pdf （本文読めず）
- 三重県 https://www.pref.mie.lg.jp/TOPICS/m0035900029.htm
- 国交省 自治体窓口一覧（PDF、未取得） https://www.mlit.go.jp/toshi/content/001860404.pdf （リンク先は morido-madoguchi.html から。URLは推定）、ページ https://www.mlit.go.jp/toshi/morido-madoguchi.html
- 国交省 大規模盛土造成地マップ公表状況（2020年3月: 1,741市区町村で公表完了、造成地あり1,003・なし738。検索要約） https://www.mlit.go.jp/report/press/content/001336294.pdf （PDF本文読めず）
- [GSI-LIST] 地理院タイル一覧 https://maps.gsi.go.jp/development/ichiran.html （前半10万字まで）
- [GSI-DEV] 地理院タイル利用 https://maps.gsi.go.jp/development/index.html （前半10万字まで）
- [GSI-TOS] 国土地理院コンテンツ利用規約 https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
- [GSI-NEW] https://www.gsi.go.jp/johofukyu/johofukyu40044.html
- [EOX-P] https://cloudless.eox.at/pricing
- [EOX-L] https://cloudless.eox.at/documentation/license

---

## 参謀長追記（2026-11-09）: xlsx 2件の読み取り結果
情報部が取得した xlsx を、参謀長が Python 標準ライブラリ（zipfile）で解析した。上の表で「未確認」としていた A56 の市単位の整備状況と、A33 の県別条件は次のとおり確定した。

### A56 整備済み市区町村一覧（A56_datalist_R7.xlsx、https://nlftp.mlit.go.jp/ksj/gml/codelist/A56_datalist_R7.xlsx）
| 市 | 実施状況 | 指定主体区分 | 告示 | 施行年月日 |
|---|---|---|---|---|
| 熱海市（22205） | 実施済 | A | 静岡県告示第799号の3 | 2025-05-26 |
| 富士市（22210） | 実施済 | A | 静岡県告示第799号の3 | 2025-05-26 |
| 静岡市（22100、葵・駿河・清水区とも） | 実施済 | B | 告示番号なし | 2025-05-26 |
| 松江市（32201） | 実施済 | C | 松江市告示第530号 | 2025-07-01 |
- 4市とも A56 は整備済み。島根県内の他の市町（出雲市・大田市等）は「未実施」。
- 指定主体区分 A/B/C の定義は xlsx 内に記載がなく未確認（県指定・政令市・中核市等の区分と推測されるが、推測）。

### A33 県別の追加利用条件（A33_permision_R7.xlsx、https://nlftp.mlit.go.jp/ksj/gml/codelist/A33_permision_R7.xlsx）
- 「追加して附す利用条件」の表にある県は、神奈川・京都・和歌山・鳥取・広島・長崎の6県のみ。**静岡県・島根県は追加条件なし。**
- 全県共通の注意: 概略位置（1/25,000〜1/50,000相当）で法定図書ではない、宅建業法の重要事項説明等の根拠に使えない、県内の全区域を網羅していない、指定・解除は直ちに反映されない。
- 同 xlsx の「その他の情報」の表で、静岡県は「静岡県地理情報システム 静岡県GIS（https://www.gis.pref.shizuoka.jp/）で公開されているデータを加工したもの」と記載。アプリに表示する際はこの表記も添える。
- データ整備時点: 静岡県 R6.8末（急傾斜地の崩壊・地すべり）、R6.12.6（土石流）。島根県 R7.3末。
