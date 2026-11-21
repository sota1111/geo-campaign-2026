// 各アプリ（今の案7件＋新しい案〈比較用・未選定〉）のメタデータ。各アプリは apps/<id>/index.html の独立ページ（本体は src/standalone/<id>.tsx が読み込む）。

export type DataKind = 'real' | 'fictional' | 'partial'
export type ContestId = 'odpt-2026' | 'udc-2026' | 'satellite-2026' | 'ichibiz-2026'

export interface ContestMeta {
  id: ContestId
  name: string
  short: string
}

export interface AppMeta {
  id: string
  name: string
  contest: ContestId
  /** 部門・提案名など */
  division: string
  /** 締切の表示用文字列（contests/registry.json の値に基づく） */
  deadline: string
  /** 締切の ISO 日時 */
  deadlineAt: string
  /** 誰向けか（概要カード・サイドバーに表示） */
  audience: string
  /** 使用目的の一文（概要ページのカードとページ見出しに表示） */
  purpose: string
  dataKind: DataKind
  /** データ種別の補足（バッジのツールチップ・ページ見出し用） */
  dataNote: string
  /** 元の静的アプリ（リポジトリ内の相対パス。プレースホルダ表示用） */
  originalPath: string
  /** 新しい案（埋め込み）の出典。ヘッダーの「出典・ライセンス」に出す（元の静的版の出典欄・README と同じ内容） */
  sources?: { name: string; provider?: string; license?: string; note?: string }[]
  /** 'new' = 新しい案（比較用・未選定）。省略時は今の案 */
  plan?: 'current' | 'new'
  /** 新しい案が隣に並ぶ、今の案の id（ポータルで同じ部門の中に並べる） */
  pairWith?: string
  /** 新しい案のカードに添える注記（同時提出不可など） */
  pairNote?: string
  /** pairWith のほかに見比べたい案の id（別のコンペでもよい）。カード・帯・相手側のヘッダーに「見比べる」リンクを出す */
  alsoCompare?: string[]
  /** 元の静的版を iframe で開くアプリの、同梱コピーのフォルダ（public/embedded/<embed>/）。省略時は React 版 */
  embed?: string
  /** 今の状態（データがまだ無い等）。新しい案のカードと帯に出す。数値は書かない */
  stateNote?: string
  /** 元のソースが、まだ main にない PR（例: 'PR #36'）にだけある案。ソースが無いビルドでは、ページとカードに「審査待ちのため含まれていない」と出す（copy-data の EMBEDS.pending と同じ値） */
  pendingPr?: string
  /** 元の静的版の画面内の見出しが registry の name と違うときの、その見出し（帯に1行で添える） */
  demoTitle?: string
}

/** 提出文のみで、デモを持たない案（ポータルに「カードだけ」置く。クリックできるデモはない） */
export interface CardOnly {
  id: string
  name: string
  contest: ContestId
  division: string
  pairWith: string
  /** 締切の表示（カードの下の行） */
  deadline?: string
  /** カードの本文（何の案か・何がまだ無いか） */
  note: string
  /** デモを開けるアプリの id（あれば「デモを開く」を出す） */
  demoAppId?: string
  /** 提出文を読むリンク（サイトルートからの相対パス。copy-data が submission/ の md を .txt にして置く） */
  docs: { label: string; path: string }[]
}

export const NEW_PLAN_LABEL = '新しい案（比較用・未選定）'

export const CONTESTS: ContestMeta[] = [
  { id: 'odpt-2026', name: '公共交通オープンデータチャレンジ2026', short: 'ODPT' },
  { id: 'udc-2026', name: 'アーバンデータチャレンジ2026', short: 'UDC' },
  { id: 'satellite-2026', name: '衛星データ活用アワード2026–2027', short: '衛星アワード' },
  { id: 'ichibiz-2026', name: 'イチBizアワード2026', short: 'イチBiz' },
]

export const APPS: AppMeta[] = [
  {
    id: 'odpt',
    audience: '住民・家族向け',
    name: '生活アクセス診断マップ',
    contest: 'odpt-2026',
    division: '本応募（UDC 作品①としても提出）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      '車を運転しない家族が、平日の朝に公共交通か徒歩で30分以内に病院へ行けるかを確かめ、結果を離れた家族に共有する。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータ（GTFS）・国土数値情報などの実データ',
    originalPath: 'contests/odpt-2026/app/web/',
  },
  {
    id: 'udc-moritsuchi',
    audience: '住民向け',
    name: 'みんなの盛土ウォッチ',
    contest: 'udc-2026',
    division: '作品②',
    deadline: '2026/12/27 23:59（概要登録は 11/15 23:59）',
    deadlineAt: '2026-12-27T23:59:00+09:00',
    purpose:
      '住民が自宅の周りの大規模な盛土造成地を知り、気づいた変化を記録して、市に伝える準備をする。',
    dataKind: 'real',
    dataNote: '大規模盛土造成地（熱海市）は公開データ。記録は利用者が入力した内容をこの端末にだけ保存',
    originalPath: 'contests/udc-2026/app/moritsuchi-watch/',
  },
  {
    id: 'sat-a',
    audience: '道路管理者向け',
    name: '路面下リスクの二段階調査',
    contest: 'satellite-2026',
    division: '提案A',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '道路管理者が、路面下の空洞調査の候補区間を衛星の指標などで絞り込み、地中レーダ調査の対象を予算内で選び、結果を次の絞り込みに活かす流れを確かめる。',
    dataKind: 'real',
    dataNote: '衛星の階級・道路・下水道台帳は豊中市北東部の実データ。地中レーダの結果は同梱せず利用者がCSVで入れる（説明用デモの架空の結果は既定オフ）',
    originalPath: 'contests/satellite-2026/app/proposal-a/',
  },
  {
    id: 'sat-b',
    audience: '自治体職員向け',
    name: '盛土巡視台帳',
    contest: 'satellite-2026',
    division: '提案B',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '盛土規制の担当職員が、大規模盛土造成地の台帳から今月巡視する場所を決めて計画を書き出し、巡視結果を記録する。',
    dataKind: 'partial',
    dataNote: '横須賀市の造成地データは実データ、衛星由来の変化量は未接続（架空サンプル）',
    originalPath: 'contests/satellite-2026/app/proposal-b/',
  },
  {
    id: 'biz-business',
    audience: '交通担当者向け',
    name: 'バス路線見直し案の比較',
    contest: 'ichibiz-2026',
    division: 'ビジネス部門',
    deadline: '2026/11/30 20:00',
    deadlineAt: '2026-11-30T20:00:00+09:00',
    purpose:
      '交通担当者が、路線を廃止する見直し案を2つ作り、病院へ行けなくなる人が少ない案を比べて会議資料にまとめる。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータ・人口メッシュなどの実データ',
    originalPath: 'contests/ichibiz-2026/app/business/web/',
  },
  {
    id: 'biz-idea',
    audience: '聞き取り担当者向け',
    name: '地名の記憶マップ',
    contest: 'ichibiz-2026',
    division: 'アイデア部門',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '地域の聞き取り担当者が、地名にまつわる災害の言い伝えを公開データで確かめ、聞き取った話を記録して地図に残す。',
    dataKind: 'partial',
    dataNote: '自然災害伝承碑は実データ、地名と語りはサンプル（架空）',
    originalPath: 'contests/ichibiz-2026/app/idea/',
  },
  {
    id: 'biz-realestate',
    audience: '土地所有者向け',
    name: '相談前の1枚シート',
    contest: 'ichibiz-2026',
    division: '不動産情報活用部門',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '相続した土地の所有者が、売る・貸す・活かす・手放すのどれにするか専門家に相談する前に、土地の条件と聞くべきことを1枚にまとめる。',
    dataKind: 'partial',
    dataNote: '徳島市の用途地域・災害想定区域、不動産情報ライブラリの取引価格・地価公示/地価調査・区域区分（2026-11-12取得）は実データ。「サンプルの土地」は架空',
    originalPath: 'contests/ichibiz-2026/app/realestate/web/',
  },
  {
    id: 'sat-alpha',
    plan: 'new',
    pairWith: 'sat-b',
    pairNote: '盛土巡視台帳（提案B）と同じ共通テーマ2。同時提出はできません（どちらか一方を選びます）。',
    embed: 'sat-alpha',
    audience: '配電事業者・自治体向け',
    name: '配電線沿いの優先伐採地図',
    contest: 'satellite-2026',
    division: '共通テーマ2（新案α）',
    demoTitle: '配電線 樹木リスク台帳',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '倒木で止まる配電を、衛星で先に見つける。配電線の区間ごとに点数をつけ、現地確認に回す区間を選び、記録の結果で点数を見直す流れを確かめる（コンセプトデモ）。',
    dataKind: 'partial',
    dataNote: '①〜④の配電線・区間・点数・停電戸数は架空。⑤の樹高マップ（Meta・WRI。東京都青梅市周辺）は実データで、線は利用者が引く仮の線',
    originalPath: 'contests/satellite-2026/app/proposal-alpha/',
    sources: [
      { name: '樹高マップ（⑤）', provider: 'Meta・WRI High Resolution Canopy Height Maps（AWS Open Data）', license: 'CC BY 4.0', note: 'Maxar の衛星画像と機械学習による推定。東京都青梅市周辺、取得 2026-11-13、元画像の撮影日 2020-02-09（冬季）。' },
      { name: '配電線・区間・点数・停電戸数・現地確認（①〜④）', note: 'すべて架空のサンプルです（実在の配電線ではありません）。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'biz-business-nb',
    plan: 'new',
    pairWith: 'biz-business',
    embed: 'biz-business-nb',
    audience: '回収の計画を考える人向け',
    name: '使用済み太陽光パネルの回収圏計画',
    contest: 'ichibiz-2026',
    division: 'ビジネス部門（新案NB）',
    deadline: '2026/11/30 20:00',
    deadlineAt: '2026-11-30T20:00:00+09:00',
    purpose:
      '京都府の太陽光設備を地図にし、廃棄時期を仮説で推定して、リサイクル施設からの回収圏の内外と、拠点を1か所足した場合の変化を見る。',
    dataKind: 'real',
    dataNote: '資源エネルギー庁の再エネ事業計画認定情報（京都府）。位置は町字の代表点（推定）、廃棄時期は仮説',
    originalPath: 'contests/ichibiz-2026/app/business-nb/web/',
    sources: [
      { name: '太陽光設備の認定情報（京都府）', provider: '資源エネルギー庁 事業計画認定情報 公表用ウェブサイト', note: '太陽光のみ抽出し、住所を位置に変換して加工。認定情報は毎月更新されます。' },
      { name: '設備の位置', provider: '国土地理院 住所検索API', note: '町字の代表点（推定）です。設備の正確な位置ではありません。廃棄時期は仮説で推定しています。' },
      { name: 'リサイクル施設', provider: '京都府（使用済太陽光パネルの適正処理のページ）', note: '事業者名・所在地・URLのみ使用。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（淡色地図）', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'biz-realestate-rn1',
    plan: 'new',
    pairWith: 'biz-realestate',
    embed: 'biz-realestate-rn1',
    audience: '住まい探しの人向け',
    name: '住む場所の先行き',
    contest: 'ichibiz-2026',
    division: '不動産情報活用部門（新案RN1）',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '家や土地を買う前に地図で場所を指し、市の立地適正化計画の区域・周りの将来人口（推計）・小学校区・徒歩圏の施設・災害の想定を重ねて見る。',
    dataKind: 'real',
    dataNote: '不動産情報ライブラリ（国土交通省）のデータ（徳島市周辺）。将来人口は推計',
    originalPath: 'contests/ichibiz-2026/app/realestate-rn1/',
    sources: [
      { name: '立地適正化計画の区域・将来推計人口・小学校区・学校・保育園等・医療機関・福祉施設・災害の想定区域', provider: '不動産情報ライブラリ（国土交通省）API', note: '国土数値情報・都市計画決定GISデータ等を API で取得して同梱（ブラウザからは API を呼びません）。将来人口は推計です。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'biz-realestate-a4',
    plan: 'new',
    pairWith: 'biz-realestate',
    embed: 'biz-realestate-a4',
    audience: '土地の価格の違いに戸惑う人・説明する専門職向け',
    name: '同じ土地、四つの値段',
    contest: 'ichibiz-2026',
    division: '不動産情報活用部門（新案A4）',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '地図で場所を指すと、近くの標準地について、公示価格・相続税路線価・取引事例比較法比準価格・収益価格を同じ単位（円/㎡）で並べる。標準地の価格であり、指した土地の価格ではない。',
    dataKind: 'real',
    dataNote: '不動産情報ライブラリ（国土交通省）の鑑定評価書情報と地価公示のポイント（福岡県・2025年）。標準地の価格で、指した土地の価格ではない',
    originalPath: 'contests/ichibiz-2026/app/realestate-a4/',
    sources: [
      { name: '鑑定評価書情報（取引事例比較法比準価格・収益価格・還元利回り・相続税路線価・標準地の位置と所在）', provider: '不動産情報ライブラリ（国土交通省）API（XCT001）', note: 'API で取得して同梱（ブラウザからは API を呼びません）。同じ標準地に記録が2件ある場合は、違う値を並べて示します。' },
      { name: '地価公示の当年価格（公示価格として表示）', provider: '不動産情報ライブラリ（国土交通省）API（XPT002）', note: '標準地と位置・用途で突き合わせ。できない地点は「照合できませんでした」と表示します。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'biz-realestate-timeline',
    plan: 'new',
    pairWith: 'biz-realestate',
    embed: 'biz-realestate-timeline',
    audience: '住み替え・購入を考える個人、区の市況を説明する担当者向け',
    name: '23区、値段の年表',
    contest: 'ichibiz-2026',
    division: '不動産情報活用部門・アイデア部門（新案・時間地図）',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '東京23区の中古マンションの㎡単価（中央値）を、区より小さい地区（町名）ごとに、間取りを選んで塗り、時間（年）のスライダーと再生ボタンで推移を動かして見る。地区を押すと、その間取りの折れ線と取引件数が出る。件数が少ない地区・年は明示して薄く塗り、件数ゼロはデータなしにする。借家の家賃は区ごと（間取り・地区には分けられない）。',
    dataKind: 'real',
    dataNote: '不動産情報ライブラリ（国土交通省）の取引価格情報（2005年第3四半期〜2026年第2四半期の中古マンション等）を地区名×間取り×年（直近5年の窓）に集計したものと、総務省統計局の家賃（住宅・土地統計調査。2008・2013・2018・2023年。区ごと）。過去の集計で、物件の価格ではない',
    originalPath: 'contests/ichibiz-2026/app/realestate-timeline/',
    sources: [
      { name: '不動産価格（取引価格）情報（中古マンション等。地区名×間取り×年の件数・中央値・四分位に集計）', provider: '不動産情報ライブラリ（国土交通省）API（XIT001）', note: 'API で取得して集計・同梱（ブラウザからは API を呼びません）。' },
      { name: '専用住宅の1畳当たり家賃（市区町村。2008・2013・2018・2023年）', provider: '総務省統計局「社会・人口統計体系」（基は住宅・土地統計調査）。e-Stat 統計ダッシュボードAPI', note: '5年ごとの調査。間の期は直前の調査の値を出します。借家全体の平均で、民営賃貸マンションだけではありません。' },
      { name: '地区・区の境界', provider: '政府統計の総合窓口（e-Stat）境界データ「国勢調査 2020年 小地域（町丁・字等）」（総務省統計局）', license: 'e-Stat 利用規約（政府標準利用規約準拠）', note: '町丁目を町名ごとに束ね、簡略化して同梱。加工して作成。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'udc-aed',
    plan: 'new',
    pairWith: 'biz-idea',
    embed: 'udc-aed',
    audience: '住民・自治体の担当者向け',
    name: '夜も使えるAED診断マップ',
    contest: 'ichibiz-2026',
    division: 'アイデア部門 IN1 のデモ（UDC には登録しない）',
    pairNote:
      'UDC には登録しないことが決まりました（11/13 総司令官）。このアプリはイチBiz アイデア部門 IN1「いま使えるAED地図」のデモとして使います。',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '自治体が公開したAEDの利用可能な曜日・時間から、選んだ曜日と時刻に徒歩圏で使えるAEDがない地区を地図で見て、24時間使えるAEDを1台置いた場合の変化を試算する。',
    dataKind: 'real',
    dataNote: '町田市・福岡市・井原市・倉敷市が公開したAED設置のオープンデータと、国勢調査の地域メッシュ人口。時間表記を読めないAEDは「不明」として数える',
    originalPath: 'contests/udc-2026/app/aed-night/',
    sources: [
      { name: 'AED の設置場所と利用可能な曜日・時間', provider: '町田市・福岡市・井原市・倉敷市のオープンデータ（井原市・倉敷市は「出典：おかやまオープンデータカタログ」）', note: '時間表記を読めない AED は「不明」として数えます。' },
      { name: '人口', provider: 'e-Stat 統計GIS 令和2年国勢調査 地域メッシュ統計（250m メッシュ、総務省統計局）' },
      { name: '市の境界', provider: '国土数値情報（行政区域 N03）をもとに CODH・NII の Geoshape が加工したデータ', note: '地図表示用に単純化しています。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（淡色地図）', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'odpt-teiji',
    plan: 'new',
    pairWith: 'odpt',
    embed: 'odpt-teiji',
    audience: '事業者・自治体向け',
    name: 'バス定時性カルテ',
    contest: 'odpt-2026',
    division: '新案（定時性）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      'バスの位置データ（GTFS-RT）を時刻表と突き合わせ、どの路線の・どの時間帯の・どの区間で遅れるかを見える化し、ダイヤや運用の見直し材料にする。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータセンターの実データ（CC BY 4.0）。昼間の取得データから集計。位置から推定した参考値で、実データでの推定精度は未検証',
    stateNote:
      '昼間の取得結果を反映し、東京都交通局の路線別集計を表示できます。短期間の参考値です。事業者・時間帯ごとにサンプル不足を表示し、自動収集は未設定です。',
    originalPath: 'contests/odpt-2026/app-teiji/web/',
    sources: [
      { name: 'バスの位置（GTFS-RT）と時刻表（GTFS）', provider: '公共交通オープンデータセンター（各事業者）', license: 'CC BY 4.0', note: '位置から遅れを推定・集計した参考値です（実データでの推定精度は未検証）。事業者ごとの状態（蓄積前・サンプル不足）は画面内に表示します。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'sat-yabu',
    plan: 'new',
    pairWith: 'sat-b',
    pendingPr: 'PR #36',
    embed: 'sat-yabu',
    audience: '自治体の鳥獣担当向け',
    name: 'クマ対策：藪払いの優先地図',
    contest: 'satellite-2026',
    division: '新案（藪払い）',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '集落のまわりで、クマが身を隠しながら人里に近づく帯（耕作放棄地・藪・林縁）を衛星で絞り、クマ出没の履歴と人家・学校との近さを重ねて、刈り払いの優先順位を決める流れを確かめる（コンセプトデモ）。',
    dataKind: 'real',
    dataNote: '京都府与謝野町周辺。衛星（Sentinel-2）・京都府のクマ目撃情報（2009〜2018年度。最新ではない）・OpenStreetMap の建物は公開データを実際に取得したもの。点数の配点は説明用の仮置き',
    originalPath: 'contests/satellite-2026/app/proposal-yabu/',
    sources: [
      { name: 'クマ目撃（位置・年月日・環境区分）', provider: '京都府「クマ目撃情報」（BODIK オープンデータ）', license: 'CC BY 4.0', note: '2009〜2018年度。最新ではありません。' },
      { name: '建物・学校・幼稚園', provider: '© OpenStreetMap contributors', license: 'ODbL', note: '未登録の建物があります（市街地中心部は特に少ない）。' },
      { name: '衛星（新緑期・落葉期）', provider: 'Copernicus Sentinel-2 L2A（AWS Open Data、Earth Search 経由）', license: 'Copernicus データの利用条件（自由・無償）' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（標準地図）', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'sat-sugi',
    plan: 'new',
    pairWith: 'sat-b',
    pendingPr: 'PR #36',
    embed: 'sat-sugi',
    audience: '都道府県・市町村の林務担当向け',
    name: 'スギ植え替えの優先地',
    contest: 'satellite-2026',
    division: '新案（スギ植え替え）',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '花粉症対策のスギ人工林の伐採・植え替えで、どの林から手を付けると、花粉を浴びる人が多い所を先に減らせそうかを、公開データで当たりを付ける流れを確かめる（比較用デモ）。',
    dataKind: 'real',
    dataNote: '東京都青梅市中心の公開データ（環境省の植生図・国勢調査メッシュ・気象庁の風向・Sentinel-2）の加工。優先度の式・人口を数える半径などは説明用の仮置き。花粉の量や効果は示さない',
    originalPath: 'contests/satellite-2026/app/proposal-sugi/',
    sources: [
      { name: '植林の位置', provider: '環境省 生物多様性センター 現存植生図2024（関東ブロック）', note: '調査年度が古い場所があります。' },
      { name: '人口', provider: 'e-Stat 地域メッシュ統計 250mメッシュ（T001102）' },
      { name: '風向', provider: '気象庁「過去の気象データ検索」（アメダス青梅）' },
      { name: '衛星', provider: 'ESA／Copernicus Sentinel-2 L2A（Element 84 Earth Search）' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（淡色地図）', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'odpt-kankou',
    plan: 'new',
    pairWith: 'odpt',
    pendingPr: 'PR #36',
    embed: 'odpt-kankou',
    audience: '住民・自治体・事業者向け',
    name: '観光バスを避ける生活ルート',
    contest: 'odpt-2026',
    division: '新案（観光系統を避ける）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      '時刻表（GTFS）と観光地点のオープンデータから「観光地点の近くを通る系統・時間帯」を推定し、住民の通院・通勤・通学の経路を観光系統を避けて探す。自治体・事業者向けには系統×時間帯の一覧とCSVを出す。',
    dataKind: 'real',
    dataNote: '浅草・上野・押上周辺。都営バス・台東区コミュニティバスの GTFS（CC BY 4.0）と国土数値情報の実データ。観光系統・観光客の多い時間帯は仮定で、混雑度の実データは使っていない',
    originalPath: 'contests/odpt-2026/app-kankou/web/',
    sources: [
      { name: '都営バス GTFS・台東区コミュニティバス（めぐりん）GTFS', provider: '公共交通オープンデータセンター（東京都交通局・台東区）', license: 'CC BY 4.0' },
      { name: '観光地点', provider: '国土数値情報 観光資源 P12-14（平成26年度版、国土交通省）', note: '元の README に、データ詳細ページの利用条件は「非商用」とあります。' },
      { name: '病院・学校・鉄道駅', provider: '国土数値情報 P04-20・P29-21・N02-22（国土交通省）', license: '国土数値情報の利用規約（出典明記）' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（淡色地図）', license: '国土地理院の利用規約' },
    ],
  },
  {
    id: 'odpt-kansui',
    plan: 'new',
    pairWith: 'odpt',
    pendingPr: 'PR #36',
    embed: 'odpt-kansui',
    audience: '駅を使う住民・通勤者、施設管理者・自治体向け',
    name: '大雨のときに避けたい駅の出入口と迂回',
    contest: 'odpt-2026',
    division: '新案（冠水しやすい駅の出入口）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      '浸水想定（洪水・高潮）と駅の出入口の位置を重ね、大雨のときに避けたい出入口と、代わりの出入口・隣の駅・近くのバス停を示す。想定であり、実際の冠水の予測ではない。',
    dataKind: 'real',
    dataNote: '東京都区部の中央部〜東部。都営バス GTFS（CC BY 4.0）・OpenStreetMap の駅と出入口・国土地理院の重ねるハザードマップのタイル。駅と出入口の位置は ODPT ではなく OSM',
    originalPath: 'contests/odpt-2026/app-kansui/web/',
    sources: [
      { name: '都営バス GTFS-JP', provider: '東京都交通局・公共交通オープンデータ協議会（公共交通オープンデータセンター）', license: 'CC BY 4.0' },
      { name: '駅・出入口の位置', provider: '© OpenStreetMap contributors（Overpass API）', license: 'ODbL 1.0' },
      { name: '洪水・高潮浸水想定区域（想定最大規模）', provider: '国土地理院「重ねるハザードマップ」のタイル（国土交通省・東京都）', license: '同サイトの利用規約（出典明記）' },
      { name: '背景地図', provider: '国土地理院 地理院タイル（淡色地図）', license: '地理院タイル利用規約' },
    ],
  },
  {
    id: 'odpt-kodure',
    plan: 'new',
    pairWith: 'odpt',
    pendingPr: 'PR #19',
    embed: 'odpt-kodure',
    audience: '子連れの家族向け',
    name: '子連れお出かけ診断',
    contest: 'odpt-2026',
    division: '新案（子連れお出かけ）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      '休日に、ベビーカーでも無理のない徒歩で、公園・動物園・水族館・博物館などへ片道何分で行けるか、夕方に家へ帰れるかを、東京都区部の地図で診断する。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータセンターの GTFS・国勢調査メッシュ・国土数値情報を使用。徒歩速度などは仮定',
    stateNote:
      '行き先データ（国土数値情報 P13・P27）は、非商用の利用条件を事務局に問い合わせ中のため同梱していません。画面は表示されますが、行き先は出ません。',
    originalPath: 'contests/odpt-2026/app-kodure/web/',
    sources: [
      { name: '公共交通の時刻表（GTFS）', provider: '公共交通オープンデータセンター（ODPT 15データ）', license: 'CC BY 4.0 または公共交通オープンデータ基本ライセンス' },
      { name: '行き先（公園・文化施設）', provider: '国土数値情報 P13・P27（国土交通省）', note: '使用許諾条件は「非商用」。事務局に問い合わせ中のため、このビルドには同梱していません。' },
      { name: '人口', provider: 'e-Stat 令和2年国勢調査 地域メッシュ統計（T001102）', license: '政府統計の総合窓口の利用規約（出典明記）' },
      { name: '背景地図・住所検索', provider: '国土地理院 地理院タイル・地名検索API', license: '国土地理院の利用規約（出典明記）' },
    ],
  },
  {
    id: 'biz-solar-guard',
    plan: 'new',
    pairWith: 'biz-idea',
    pendingPr: 'PR #18',
    embed: 'biz-solar-guard',
    audience: '発電事業者・O&M事業者・保険会社・自治体や警察の防犯担当向け',
    name: '太陽光発電所の盗難対策マップ',
    contest: 'ichibiz-2026',
    division: 'アイデア部門のみ（新案）',
    pairNote: '出すならアイデア部門（12/10 20:00）のみ。ビジネス部門には出さず、2部門への同時応募もしません。資源エネルギー庁への電話確認の結果しだいで作り替えます。',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '銅線ケーブル等の金属盗から太陽光発電所を守る対策の優先順位を、公開データから作る「目安」で考える。公開するのは約2kmメッシュの四角・町字の代表点に置く円（散布図）・市町村の集計だけで、個別設備は出さない。背景は地図と空中写真を切り替えられる。自分の発電所の位置と対策を入れる自己診断はブラウザ内だけで計算する。',
    dataKind: 'real',
    dataNote: '茨城県。資源エネルギー庁の再エネ事業計画認定情報（太陽光）と e-Stat の人口メッシュの集計に、茨城県警の県内5地区別の太陽光発電施設の被害件数（令和7年11月末・令和8年9月末、暫定値、誌面から転記）を重ねる。市町村・町字の被害件数は公開されておらず、按分もしない。被害の予測ではない',
    originalPath: 'contests/ichibiz-2026/app/solar-guard/',
    sources: [
      { name: '太陽光設備の認定情報（茨城県）', provider: '資源エネルギー庁 事業計画認定情報', note:'町字名を e-Stat 小地域の名称と突き合わせて集計。事業者名・設備ID等は取り込まず、個別設備の位置は公開しません。利用ルールは資源エネルギー庁に確認中です。' },
      { name: '人口', provider: 'e-Stat 地域メッシュ統計（令和2年国勢調査）' },
      { name: '盗難の実際の件数（県内5地区・県計）', provider: '茨城県警察 Metal News 令和7年第12号・令和8年第10号、金属盗難の統計ページ', license: '数値のみ転記（出典・時点を画面に表示）。地区より細かい公開データはありません', note: '令和7年11月末は県西373・県南342・県央152・鹿行93・県北49、令和8年9月末は県西109・県南164・県央84・鹿行38・県北39（暫定値）。' },
      { name: '背景地図（淡色地図）', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
      { name: '背景の空中写真', provider: '国土地理院 地理院タイル（シームレス空中写真）', license: '国土地理院コンテンツ利用規約（出典表示）', note: '切り替えで表示。EOX Sentinel-2 cloudless は商用に有償ライセンスが要るため使いません。' },
    ],
  },
  {
    id: 'biz-repair',
    plan: 'new',
    pairWith: 'biz-idea',
    embed: 'biz-repair',
    audience: 'マンションの管理組合・理事、区分所有者、修繕を支援する担当者向け',
    name: '大規模修繕プラットフォーム',
    contest: 'ichibiz-2026',
    division: 'アイデア部門（新案・部門は未選定）',
    pairNote:
      '部門はまだ選んでいません（総司令官が選びます）。アイデア部門のデモとして最も素直に合いますが、ビジネス部門・不動産情報活用部門に出す場合の合い方は README に書きました。',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '墨田区の PLATEAU の建物を地図で選ぶと、国土交通省の調査の分布から、大規模修繕費の「目安の範囲」と、見積の「分布での位置」（中央値より◯%高い、上位25%に入る、など）が出る。適正な金額であることを保証しない。点群（スマホ LiDAR など）から外壁面積の概算、規模の近い「似た建物」、発注先を比べる公的リンクとチェック項目、利用者が登録する事例・口コミの受け皿もある（事例・口コミのデモは架空）。',
    dataKind: 'partial',
    dataNote:
      '実データ: PLATEAU（墨田区 46,386 棟。高さ・屋根外形・住所）と、国交省の令和3年度実態調査（分布の転記）。PLATEAU に建築年・階数・延床・用途は入っていない（付与率0%）ので、階数・延床は推定。デモの事例・口コミと見本の点群は、架空・合成',
    originalPath: 'contests/ichibiz-2026/app/repair-platform/',
    sources: [
      { name: '建物（墨田区。高さ・屋根外形・住所）', provider: '3D都市モデル（Project PLATEAU）東京都23区（2022年度）CityGML v2（国土交通省、G空間情報センター）', license: 'PLATEAU Site Policy「3．著作権について」に拠る（商用利用可）', note: 'HTTP Range の GET で墨田区のメッシュだけ取得し、高さ・屋根外形・住所を取り出して加工・同梱。' },
      { name: '大規模修繕工事の工事金額の分布・内訳比率・修繕周期', provider: '国土交通省「令和3年度マンション大規模修繕工事に関する実態調査」報告書・概要', license: '要確認（二次利用条件が確認できていない）', note: '図表の数値を手で転記して同梱（頁つき）。工事金額は共通仮設費・消費税を含まない。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
  {
    id: 'sat-dc',
    plan: 'new',
    pairWith: 'sat-b',
    pairNote:
      '応募テーマはまだ選んでいません（総司令官が選びます）。共通テーマ2には B・α も並ぶため、同時提出はできません。README に当てはめの選択肢を書きました。',
    embed: 'sat-dc',
    audience: 'データセンター事業者・自治体の立地担当・金融／保険向け',
    name: 'データセンター候補地の一次スクリーニング',
    contest: 'satellite-2026',
    division: '新案（データセンター候補地）',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '国の GX 戦略地域（データセンター集積型）に認定された福岡県の直方・鞍手・北九州市西部で、衛星（干渉SAR の地盤変動・Landsat の地表面温度・Sentinel-2 の土地の状態と変化）から見つけた造成地・遊休地の候補、または地図で指した地点について、浸水・土砂・津波・高潮の該当、沈下の階級、夏の地表面温度、最寄りの変電所までの距離、土地の状態を、出典つきの確認項目として並べる。加えて、8 要素（洪水・土砂・津波・高潮・沈下・地表面温度・変電所までの距離・土地の状態と変化）の重みを利用者がスライダーで決めると、約 250 m 格子ごとの優先値がその場で計算し直され、地図に段階色で出る（候補地の比べる表にも優先値）。優先値は重みによる一次スクリーニングの目安で、適否の判定ではない（コンセプトデモ）。',
    dataKind: 'real',
    dataNote:
      '福岡県（直方市・鞍手町・北九州市西部）。衛星（国土地理院の干渉SAR・Landsat 9・Sentinel-2）・国土数値情報（A31b・A33・A40・A49）・OpenStreetMap の変電所と送電線は、公開データを実際に取得して加工したもの。立地の基準値は公的資料で確認できておらず、判定はしない。国土数値情報は位置の誤差が大きい。換算のしきい値（区域内=0・外=1、沈下 ±3.75〜15 mm/年、温度は範囲の 10〜90% 点、変電所 500 m〜5 km、土地の状態の値）と初期の重み（均等）はすべて仮置きで、公的な基準ではない。背景地図は地理院タイルの淡色地図',
    originalPath: 'contests/satellite-2026/app/proposal-dc/',
    sources: [
      { name: '地盤の変動', provider: '国土地理院 衛星SAR地盤変動測量成果（解析：国土地理院 原初データ所有：JAXA）', license: '国土地理院コンテンツ（出典表示。測量法上の承認の要否は要確認）', note: '準上下方向の変位速度。2014-08〜2025-11 の観測、2026-03-31 公開分。約 90 m、1 階級 3.75 mm/年。' },
      { name: '夏の地表面温度', provider: 'Landsat 9 Collection 2 Level-2（USGS。LC09_L2SP_113036_20260822_02_T1）', license: 'USGS: 利用制限なし', note: '2026-08-22 の 1 場面。気温でも冷却の効率でもない。' },
      { name: '土地の状態・近年の変化', provider: 'Copernicus Sentinel-2 L2A（S2B_52SFC_20260823_0_L2A と S2B_52SFC_20200824_0_L2A。AWS Open Data）', license: 'Copernicus データの利用条件（無償・自由）。Contains modified Copernicus Sentinel data [2026][2020]' },
      { name: '洪水・土砂・津波・高潮', provider: '国土数値情報 A31b・A33・A40・A49（国土交通省）', license: 'CC BY 4.0（一部制限）', note: '縮尺 1/25,000〜1/50,000 程度の概略。公共測量・重要事項説明には使えない。' },
      { name: '変電所・送電線・建物', provider: '© OpenStreetMap contributors', license: 'ODbL', note: '登録のない設備がある。空き容量・接続可否は分からない。' },
      { name: '背景地図', provider: '国土地理院 地理院タイル', license: '国土地理院コンテンツ利用規約' },
    ],
  },
]

export const CARDS_ONLY: CardOnly[] = [
  {
    id: 'biz-idea-in1',
    name: '「いま使えるAED」地図　夜間・施錠で使えない場所を、時間帯別のカバー率にする',
    contest: 'ichibiz-2026',
    division: 'アイデア部門（新案IN1）',
    deadline: '2026/12/10 20:00',
    pairWith: 'biz-idea',
    note: 'AEDの地図は公開されていても、点は「いつ使えるか」を示さない。町田市の公開データでは、位置と利用時間が記入された288台のうち、平日午前3時に使えるのは11台（2か所。救急車内等4台を除く本案の判定）。提出文のみ（デモは「夜も使えるAED診断マップ」。UDC には登録しない）。',
    demoAppId: 'udc-aed',
    docs: [
      { label: '課題の文を読む', path: 'submission/idea-in1/problem.txt' },
      { label: 'サービス内容の文を読む', path: 'submission/idea-in1/service.txt' },
    ],
  },
]

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  real: '実データ',
  fictional: '架空データ',
  partial: '一部架空',
}

export function getApp(id: string): AppMeta | undefined {
  return APPS.find((a) => a.id === id)
}

export function appsByContest(contest: ContestId): AppMeta[] {
  return APPS.filter((a) => a.contest === contest)
}

/** コンペ内の並び順: 今の案の直後に、その隣へ置く新しい案（ポータルのサイドバー用） */
export function orderedAppsByContest(contest: ContestId): AppMeta[] {
  const apps = appsByContest(contest)
  return apps
    .filter((a) => !isNewPlan(a))
    .flatMap((a) => [a, ...apps.filter((x) => isNewPlan(x) && x.pairWith === a.id)])
}

export function isNewPlan(a: AppMeta): boolean {
  return a.plan === 'new'
}

/** 今の案のアプリ（評価・既存テストの対象） */
export const CURRENT_APPS: AppMeta[] = APPS.filter((a) => !isNewPlan(a))

/** この案を「見比べる」相手として挙げている新しい案（相手側のヘッダーに逆向きのリンクを出す） */
export function alsoComparedBy(id: string): AppMeta[] {
  return APPS.filter((a) => a.alsoCompare?.includes(id))
}

/** 今の案 id から、その隣に並ぶ新しい案を引く（今の案のヘッダーに「見比べる」リンクを出すため） */
export function newPlansOf(currentId: string): AppMeta[] {
  return APPS.filter((a) => isNewPlan(a) && a.pairWith === currentId)
}
