# 偵察レポート: イチBiz 2026 ビジネス部門 海外事例起点の新案

contest-id: ichibiz-2026（ビジネス部門、締切 2026/11/30 20:00）／作成: 偵察隊／2026-11-12

**報告先ファイルについて。** 報告先は reports/recon/ichibiz-2026-business-newplan-20261112.md でしたが、このエージェントには「報告書の .md を書かず本文で返す」という運用制約があり、ファイルは作っていません。以下をそのまま保存してください。contests/ は未変更、git 操作なしです。試作は使い捨ての採点スクリプト1本で、sandbox/recon/ichibiz-2026-business-newplan/score.py にあります。

## 0. 結論

1. **最良の新案は NB「使用済み太陽光パネルの『回収圏』計画」です。** 排出予測と回収・再資源化拠点の立地を、発電事業者・再資源化事業者・自治体向けに出します。
2. 理由は3つです。
   - 国が 2026年4月3日に法律案を閣議決定済みで、払う理由に期限と法的根拠があります。
   - 全国規模の民間回収マッチングは、今回の検索では見つかりませんでした（探索の限界あり）。
   - 公開データで試算でき、海外に SOLARCYCLE（総調達約3,700万ドル）という実績があります。
3. 採点は NB が 18点、現行 B0 が 16〜17点で、差は1〜2点です。偵察隊1人の骨組み採点なので誤差の範囲です。点数だけでは乗り換えを正当化できません。決め手は、総司令官が11/30までに本人の素材（経験とヒアリング）を NB に載せられるかです（7章）。

## 1. 海外事例（14件。分野を限定せず収集）

出典の強さは次のとおりです。「一次」は当事者発表、「報道」は報道・業界紙、「要約」は検索結果の要約のみで本文は未取得です。顧客数・売上・調達額は、特記がなければ要約段階です。

| # | 分野 | 事例 | 事業モデルと証拠 | 出典 |
|---|---|---|---|---|
| 1 | エネルギー（立地） | Paces（米） | 再エネ・データセンター開発者向けに、候補地探索と許認可リスクの SaaS を提供。2024年7月に Series A 1,100万ドル（報道）。顧客数・社名は未確認 | https://www.utilitydive.com/news/data-platform-paces-nabs-11m-to-scale-clean-energy-development/722760/ |
| 2 | エネルギー（植生） | Overstory（米） | 衛星と AI で送配電線沿いの樹木リスクを出す。2025年11月に Series B 4,300万ドル。米州の大手電力10社のうち6社が顧客（自称）。PG&E が顧客 | https://impactalpha.com/overstory-secures-43-million-to-predict-and-prevent-utility-sparked-fires/ |
| 3 | エネルギー（山火事） | Pano AI（米） | カメラ網と AI の山火事検知。2025年6月に Series B 4,400万ドル、累計8,900万ドル。米国の電力15社が利用（報道） | https://www.renewableenergyworld.com/power-grid/smart-grids/15-utilities-are-already-using-an-ai-powered-wildfire-detection-startup-that-just-raised-another-44m/ |
| 4 | エネルギー（充電） | Stable（米） | EV 充電設置場所の予測。7,000万データ点を分析し、累計1,400万ドルを調達（2022年） | https://chargedevs.com/newswire/stable-analyzes-70-million-data-points-for-charging-site-locations-raises-14-million-in-series-a-round/ |
| 5 | エネルギー（太陽光設計） | Aurora Solar（米） | 画像から住宅用太陽光を設計する SaaS。2022年に Series D 2億ドルで評価額約40億ドル。累計約5.2億ドル（要約）。直近の評価は資料間で食い違う | https://www.canarymedia.com/articles/solar/solar-design-startup-aurora-logs-big-time-series-c |
| 6 | エネルギー（廃棄） | SOLARCYCLE（米） | 使用済みパネルの再資源化。Series A 3,000万ドル、累計3,700万ドル。Sunrun などの発電・施工事業者と提携（要約） | https://www.esgtoday.com/solar-panel-recycling-startup-solarcycle-raises-30-million-to-scale-capacity/ |
| 7 | 保険 | CAPE Analytics（米） | 航空・衛星画像から物件の屋根状態などを抽出。2025年1月に Moody's が買収を発表（金額非公表）。大手損保の約半数が顧客（CEO 発言＝自称） | https://techcrunch.com/2025/01/13/moodys-agrees-to-acquire-cape-analytics-which-develops-geospatial-ai-for-insurance-providers |
| 8 | 農業 | Cropin（印） | 農場管理と衛星による予測。2023年1月に約1,400万ドル。累計4,600万ドル（要約）。法人顧客250超（要約） | https://yourstory.com/2023/01/agritech-startup-cropin-raises-113-crore-funding-abc-impact-chiratae-ventures |
| 9 | 農業（保険） | Pula（ケニア） | 衛星と収量データによる指数保険。銀行や種子会社が融資・種子に同梱して売る。2021年に Series A 600万ドル。被保険農家数は600,000人超から100万人超まで資料でばらつく | https://techcabal.com/2021/01/25/pula-secures-new-funding/ |
| 10 | 物流 | FourKites／project44 | 位置情報で荷待ち（滞留）を計測し、荷主向けに滞留・超過料金を削減。顧客の自社発表では Kimberly-Clark で滞留料52%減（自称） | https://www.freightwaves.com/news/todays-pickup-kraft-taps-fourkites-facility-manager-to-cut-dwell-times |
| 11 | 建設 | Propeller Aero／DroneDeploy | ドローンの土工量・盛土の計測。DroneDeploy は顧客5,000超（Series D の発表）。Propeller は4,000超の顧客と22,600超の現場（第三者ツール経由）。調達額は資料間で不一致 | https://sacra.com/c/propeller/ |
| 12 | 建設（土） | Soil Connect（米）／Soil Link（英） | 残土・骨材のデジタル市場。Soil Connect は2020年にシード325万ドル、Cemex Ventures が出資。2025年にも調達（要約） | https://www.businesswire.com/news/home/20201202005692/en/Soil-Connect-Raises-3.25M-in-Seed-Funding-to-Support-Soil-and-Aggregates-Marketplace-Advancing-Mission-to-be-a-One-Stop-Shop-for-all-Dirt-Related-Needs |
| 13 | 観光 | Komoot（独） | 経路計画アプリ。約4,500万人。2023年売上は3,600万〜3,849万ドル相当の報告（第三者・不一致）。2025年3月に Bending Spoons が買収、価格は非公表 | https://www.bikeradar.com/news/komoot-acquisition |
| 14 | 小売・医療（前回収集済み） | Placer.ai／AlayaCare | 前回の偵察で確認済み。評価額約15億ドル、成長資本枠5,000万ドル | reports/recon/ichibiz-2026-business-division-20261112.md |

読み取りは3つです。

- **払い手が固定され、規制か損失が背景にある事業が強い。** 事例2・3・6・7・10 が該当します。
- **一般消費者向けは国内に強い競合が先にいる。** 事例13 の相手は YAMAP などで、今回は絞り込みから外しました。
- **「地図そのもの」ではなく、「地図から出る意思決定」を売っている。** 払い手の意思決定は、どの樹木を切るか、どこに拠点を置くか、どの現場から出すかです。

## 2. 絞り込みの結果

絞り込みの基準は、日本に同じ課題と払い手がいるか、使える公開データ、国内競合、11/30までに個人で書けるか、の4つです。

| 候補 | 判定 | 理由（出典付き） |
|---|---|---|
| 物流の荷待ち計測（事例10） | 落とす | 日本は Hacobu の MOVO Berth が先行。利用事業所37,000超（販売ページ）、累計調達56億円超（2025年5月、報道）。法の追い風はあるが、地理空間の独自性が薄い。https://thebridge.jp/2025/05/hacobu-raises-700-million-yen-for-logistics-digital-transformation-platform-movo-total-funding-exceeds-5-6-billion-yen |
| クマ出没の地図・通知 | 落とす | Bot Express は導入350超、FASTBEAR（2026年1月公開）、長野県アプリなどが既にある。かつ「地域」題材に近い（部門間の重複回避）。https://internet.watch.impress.co.jp/docs/yajiuma/2075734.html |
| EV 充電設置診断（事例4） | 落とす | 経産省は2030年に30万口の目標（2023年10月指針）。ただし払い手（施設オーナー）の支払意思の根拠が検索で取れなかった。https://sp.m.jiji.com/english/show/29093 |
| 農業（事例8・9） | 落とす | 国内に Sagri などが既にあり、衛星アワードとも題材が近い。実在の競合は本調査で個別確認していない（要確認） |
| 小売の商圏分析 | 落とす | 前回の B2 で「独創性が低い」と整理済み。Placer.ai が強い |
| **NA 建設発生土の適法搬出** | 残す | 法的な払う理由は強い。ただし民間競合が既にいる（3章） |
| **NB 使用済みパネルの回収圏** | 残す | 本命。理由は4章 |
| **NC 配電線の樹木接触リスク** | 残す | 海外の事例が最も強い。ただし国内データと顧客獲得が重い |

不動産と住まい探し、地域コミュニティと地名の題材は避けました。NA は「受入地」が土地の話に隣接するので、注意として記しておきます。

## 3. 3案の深掘り

### 3-1. NA「建設発生土の適法搬出チェック」（建設）

- **顧客と払い手:** 払い手は元請の建設会社（排出事業者）です。静岡県の資料によれば、令和6年6月から最終搬出先の確認が義務化されています。国交省資料では、登録ストックヤードに出せば元請の最終確認が不要になります。受入側（ストックヤード事業者）への課金も候補です。
  - 出典: https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/057/519/3_05_siryou.pdf
- **何を売るか:** 土量・土質・時期だけでなく、受入地が盛土規制法の規制区域か、許可があるかを地図で重ね、搬出先ごとの適法性チェックと運搬距離コストの比較を出し、証跡（確認記録）を残します。
- **価格の考え方:** 現場単位の月額か、1成約あたりの手数料です。比較対象は、ドリュースが「通常の処分費より安い」と説明しているマッチング手数料です。
- **市場:** 建設発生土の排出量は、平成24年度で約1億4,079万m3（国交省）。これは古い統計で、令和6年度調査の値は未取得です。有効利用率は資料で約90%と約78.2%の2通りが出ており、定義の違いが疑われます。
- **競合:** 国が官民マッチングを2015年から運用し、現在は建設発生土情報交換システムとして稼働しています。静岡県は独自の SSM を運用中です。民間では、ツチオク（プレテリス・ホールディングス。受入先1,860件を検索可）とドリュースが既にあります。差別化は「適法性の自動チェック」だけで、競合に追随されやすいです。
- **導入経路:** 元請の現場所長と工事部、およびストックヤード事業者です。
- **初年度の検証計画:** ①現場所長3人に、搬出先の確認に毎回かかる手間を聞きます。②規制区域の公開データ（都道府県ごとに形式がばらばら）を3県分重ねて試作します。③ツチオクの利用者に差分があるかを聞きます。
- **本人経験を載せる箇所:** 盛土や造成地で不安を感じた体験、建設・土木の身近な人への聞き取り。現時点で総司令官の素材は不明です。
- **審査基準の採点（骨組み）:** 独創2、社会4、実現3、事業3、プレゼン3。**15点**
- **リスク:** 民間競合が既にいること、規制区域データの整備が自治体ごとに違うことです。

### 3-2. NB「使用済み太陽光パネルの回収圏計画」（エネルギー × 廃棄物流）【推奨】

- **課題の事実:**
  - 経産省・環境省の資料（2026年1月23日付）では、使用済みパネルの排出が2030年代後半以降に顕著に増え、年間最大50万トン程度になるとされています。
  - 野村総合研究所の民間推計（2026年2月）は、現在は年間10万トン弱で、ピークは2040年代前半に40万トン超です。政府と民間でピーク時期が約5年ずれています。
  - 出典: https://www.meti.go.jp/shingikai/sankoshin/sangyo_gijutsu/resource_circulation/solar_power_generation/pdf/010_01_00.pdf ／ https://www.newscoda.com/articles/solar-panel-mass-disposal-recycling-law-2026/
- **法的背景:** 政府は2026年4月3日に「太陽電池廃棄物の再資源化等の推進に関する法律案」を閣議決定しました。NEDO の資料では施行は2028年1月頃の見込みです。環境省資料（2026年10月30日付）では、事業用を廃棄する者が取組主体で、多量に廃棄する者には事前届出や勧告・命令を課す方向です。**国会審議の結果は未確認です。**（出典は上記ニュース記事および NEDO 資料 https://ce-h2-re.nedo.go.jp/pdf_pgm/A1-2-14.pdf の要約）
- **顧客と払い手:** 払い手の候補は3つです。①再資源化事業者・産廃処分業者（拠点の立地・増設の判断材料）、②複数サイトを持つ発電事業者（撤去・廃棄計画の届出準備）、③都道府県・自治体（京都府のように PV パネル循環プラットフォームを運営する先）。
- **何を売るか:** 発電所の位置・出力・認定時期から排出時期を推定した地図と、受入可能な処分業者との距離・運搬の条件を重ね、回収の拠点と回収圏を示します。国のポータルでは出せない「地理」の層です。
- **使うデータ:**
  - 資源エネルギー庁の再エネ事業計画認定情報の公表サイト。設備所在地と事業者名を含みますが、出力20kW未満の太陽光は対象外です。個人事業者の連絡先は非掲載です。CSV の列名と「運転開始」の有無は未確認です。
  - 自治体の処分業者リスト（京都府・大阪府が公開）。
  - OSM 道路など。
  - 注意点は、認定日から廃棄時期を推定する部分が「仮説」であることです。
- **価格の考え方（仮説。数値は根拠なし）:** 顧客が避けられる損失（拠点の稼働率の低下、遠距離運搬）の一部を年額で請求します。拠点の投資額、運搬単価、顧客の現在の工数を、ヒアリングで取ってから式に入れます。
- **競合:**
  - 全国規模の民間回収マッチングは、今回の検索では確認できませんでした（探索の限界あり）。
  - 公的には、京都府の循環プラットフォーム、環境省の丸紅による回収・リユース情報基盤の実証（令和3〜5年度）があります。
  - 海外は SOLARCYCLE（事例6）。日本では再資源化事業者そのものが自前でやる可能性があります。
- **導入経路:** 再資源化事業者の営業、都道府県の産廃担当、発電所の O&M 事業者。
- **初年度の検証計画:**
  - ①11/30までに、再資源化事業者・解体撤去業者・O&M 事業者の3者へ聞き取り（誰が何を知りたいか、今の手間、払ってよいか）。
  - ②認定情報のデータを1県分で地図に落とし、排出時期の推定ロジックを試作します。
  - ③有識者への一次通過後に、実在の1事業者との試行を目標にします。
- **本人経験を載せる箇所:** 身近な太陽光発電所や屋根の設置・撤去の見聞、実家や知人の発電所の話、ヒアリングで聞いた生の言葉。現時点で総司令官の素材は不明です。
- **審査基準の採点（骨組み）:** 独創4、社会4、実現3、事業3、プレゼン4。**18点**
- **リスク:**
  - 市場の本格化が2030年代で、初年度の売上は小さいこと。
  - 認定日からの排出時期の推定は精度の根拠が弱いこと。
  - 法案の成立と施行時期が未確認であること。
  - 20kW未満の住宅用は公開データにないこと。

### 3-3. NC「配電線の樹木接触リスク」（エネルギー × 森林）

- **課題の事実:** 総務省行政評価局（2025年3月）の報告では、高圧配電線の樹木接触による供給支障事故が年間約2,500件で、架空電線路の事故の2割弱です。
- **顧客と払い手:** 一般送配電事業者（国内に約10社とされるが、出典未確認）が払い手です。
- **何を売るか:** 樹高・成長の推定と配電線の位置を重ね、事前伐採の優先順位を出します。
- **海外の裏付け:** Overstory（事例2）、AiDash（衛星と AI で電力向けに植生を監視。米国の事例で信頼性15%向上、植生管理予算20%減とあるが、企業自身のケーススタディ）。日本の電力会社と AiDash の契約は、検索では確認できませんでした。
- **使うデータと壁:** 配電線の位置データは公開されておらず、OSM は部分的です。樹高は国土地理院のデータでは不足で、航空レーザ点群（静岡県の公開など）は地域限定です。**ここが最大の壁**です。
- **競合:** 国内の導入事例は確認できませんでした。三菱電機と九州電力送配電は送電線・鉄塔の点検で AI 実証をしていますが、樹木接触ではありません。
- **初年度の検証計画:** ①静岡県の公開点群で樹高を試算します。②送配電事業者への接触経路を探します（個人では難しい）。
- **本人経験を載せる箇所:** 台風で停電した経験、倒木で道が塞がった見聞。差し込みやすい点は強みです。
- **審査基準の採点（骨組み）:** 独創3、社会4、実現2、事業3、プレゼン4。**16点**
- **リスク:** 売り先が少数の大手で営業が重いこと、配電線データが手に入らないこと。個人が11/30までに実現可能性を示しにくい。

## 4. 現行案 B0 との比較

| 案 | 独創 | 社会 | 実現 | 事業 | プレゼン | 合計 | 事業重視（仮定の重み） |
|---|---|---|---|---|---|---|---|
| B0 現行（Mobilys を反映した再採点。前回偵察） | 2 | 3 | 4 | 3 | 4 | 16 | 21.0 |
| NA 建設発生土 | 2 | 4 | 3 | 3 | 3 | 15 | 19.5 |
| NB 使用済みパネル回収圏 | 4 | 4 | 3 | 3 | 4 | 18 | 22.5 |
| NC 配電線の樹木接触 | 3 | 4 | 2 | 3 | 4 | 16 | 20.0 |

- B0 は OR v8 の採点が17点、Mobilys を反映すると16点です（前回偵察による）。
- 重みは偵察隊の仮定で、実現可能性×1.5、事業性×2です。
- **採点の限界:** 採点者は偵察隊1人、新案は骨組み段階、B0 は8回の改善を経ています。1〜2点の差は誤差内です。
- **新案が勝つのは、独創性と事業の筋の具体性（期限付きの法的根拠）です。**
- **B0 が勝つのは、実現可能性（データが揃っている）と磨き込みの深さです。**

## 5. 総合比較表（偵察隊SOPの形式）

| 案 | 狙う審査基準 | 必要データ | 工数見積 | リスク | 転用可否 |
|---|---|---|---|---|---|
| NA | 社会的効果 | 盛土規制区域（県ごと）、受入地リスト、道路 | 中（規制区域データの整形が重い） | 民間競合が既にいる | 不動産部門に近いため転用しにくい |
| **NB（推奨）** | 独創性、事業性 | 再エネ認定情報、処分業者リスト、道路 | 小〜中（文章化が主。1県分の試作は1〜2日） | 市場が2030年代、法案の審議結果が未確認 | ODPT/UDC には転用できない。衛星アワードは題材が別で重複もしない |
| NC | 社会的効果、プレゼン | 樹高（点群）、配電線位置 | 中〜大（データ入手が壁） | 売り先が少数、データが手に入らない | 衛星アワードの題材に隣接。転用は慎重に |

## 6. 生成AI条項への配慮（失格回避）

- 要項p.7-8は、AI出力のそのまま利用や独自性が認められない応募を控えるよう求めています。
- 本人が書く部分（AIは整えるだけ）は次の4つです。
  1. background.md（背景300字）の動機と体験。
  2. business.md の市場・顧客ニーズ欄に入れるヒアリング結果の生の言葉。
  3. 価格と払い手の判断（誰から取るかを本人が決める）。
  4. 事業化の課題欄にある、失敗しうる点の自己評価。
- 文章の骨は本人が先に書きます。AIは、誤字の確認と字数調整と、データ出典の整形に使います。
- 数値は出典のあるものだけ使い、仮説は「仮説」と明記します。

## 7. 総司令官に決めてほしいこと

1. **現行 B0 を出すか、NB に乗り換えるか。** 点数差は誤差内です。判断軸は次の2つです。
   - NB を選ぶなら、11/22までにヒアリング3者の見込みがあるか、または身近な発電所・設置の体験があるか。
   - どちらも用意できないなら、B0 のまま磨く方が安全です。
2. **NB の確認事項（情報部への依頼候補）。**
   - 法案の国会審議の結果と施行日の一次確認（環境省・経産省）。
   - 認定情報CSVの項目（運転開始年月の有無）。
3. **第2候補。** NB が不可なら NA。ただし民間競合（ツチオク・ドリュース）への差別化を本人が説明できることが条件です。NC は実現可能性を示しにくいので、今回は非推奨です。
4. **同時応募の扱い。** NB を出す場合も、アイデア・不動産部門の案と題材が重ならないことは、本調査では確認済みです（不動産・住まい・地名は不使用）。他の偵察隊の最終案が出たら、再確認してください。

## 8. 未確認・限界

- 検索結果の多くは要約段階で、調達額・顧客数に資料間の不一致があります（事例5・8・9・11・13）。
- 「全国規模の民間回収マッチングがない」は、今回の検索で見つからなかったという意味で、存在しないという意味ではありません。
- 一般送配電事業者の社数、NB の排出推定の精度、国内の農業競合の実在は未確認です。
- 総司令官自身の経験・ヒアリング可能性は私には分かりません。採点は、これを加味していません。

試作ファイル: /home/ubuntu/dev/2026/geo-campaign-2026/.claude/worktrees/agent-a5e8b9b092688b4da/sandbox/recon/ichibiz-2026-business-newplan/score.py

## 返答の要点

**推奨新案: NB「使用済み太陽光パネルの回収圏計画」。**
1. 国が2026年4月3日に法律案を閣議決定済みで、排出は年間最大50万トン程度（経産省・環境省、2026年1月）と見込まれ、期限付きの払う理由があります。
2. 全国規模の民間回収マッチングは今回の検索で見つからず、再エネ認定情報など公開データで試作でき、海外に SOLARCYCLE（累計約3,700万ドル）があります。
3. 骨組み採点は NB 18点に対して現行 B0 が16〜17点です。ただし差は誤差内で、市場の本格化は2030年代、法案の審議結果は未確認です。

**総司令官が決めること:**
1. B0 のまま出すか、NB に乗り換えるか。乗り換えるなら、11/22までに事業者3者へのヒアリング、または身近な発電所・設置の体験を本人が用意できるか。
2. NB の法案審議結果、認定情報CSVの項目確認を、情報部に依頼してよいか。
3. NB が不可の場合の第2候補は NA。民間競合との差別化を本人が説明できることが条件。

Sources:
- https://www.utilitydive.com/news/data-platform-paces-nabs-11m-to-scale-clean-energy-development/722760/
- https://impactalpha.com/overstory-secures-43-million-to-predict-and-prevent-utility-sparked-fires/
- https://www.renewableenergyworld.com/power-grid/smart-grids/15-utilities-are-already-using-an-ai-powered-wildfire-detection-startup-that-just-raised-another-44m/
- https://chargedevs.com/newswire/stable-analyzes-70-million-data-points-for-charging-site-locations-raises-14-million-in-series-a-round/
- https://www.canarymedia.com/articles/solar/solar-design-startup-aurora-logs-big-time-series-c
- https://www.esgtoday.com/solar-panel-recycling-startup-solarcycle-raises-30-million-to-scale-capacity/
- https://techcrunch.com/2025/01/13/moodys-agrees-to-acquire-cape-analytics-which-develops-geospatial-ai-for-insurance-providers
- https://yourstory.com/2023/01/agritech-startup-cropin-raises-113-crore-funding-abc-impact-chiratae-ventures
- https://techcabal.com/2021/01/25/pula-secures-new-funding/
- https://www.freightwaves.com/news/todays-pickup-kraft-taps-fourkites-facility-manager-to-cut-dwell-times
- https://sacra.com/c/propeller/
- https://www.businesswire.com/news/home/20201202005692/en/Soil-Connect-Raises-3.25M-in-Seed-Funding-to-Support-Soil-and-Aggregates-Marketplace-Advancing-Mission-to-be-a-One-Stop-Shop-for-all-Dirt-Related-Needs
- https://www.bikeradar.com/news/komoot-acquisition
- https://thebridge.jp/2025/05/hacobu-raises-700-million-yen-for-logistics-digital-transformation-platform-movo-total-funding-exceeds-5-6-billion-yen
- https://internet.watch.impress.co.jp/docs/yajiuma/2075734.html
- https://sp.m.jiji.com/english/show/29093
- https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/057/519/3_05_siryou.pdf
- https://www.meti.go.jp/shingikai/sankoshin/sangyo_gijutsu/resource_circulation/solar_power_generation/pdf/010_01_00.pdf
- https://www.newscoda.com/articles/solar-panel-mass-disposal-recycling-law-2026/
- https://ce-h2-re.nedo.go.jp/pdf_pgm/A1-2-14.pdf