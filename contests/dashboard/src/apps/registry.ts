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
    dataKind: 'fictional',
    dataNote: '道路・指標・調査結果はすべて架空のサンプル',
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
    dataNote: '公共交通オープンデータセンターの実データ（CC BY 4.0）。収集の途中で、昼間の品質は未測定',
    stateNote:
      'いまはデータを貯め始めたところで、まだ遅れの集計はありません（開くと全事業者が「データ蓄積前」と表示されます）。昼間の収集を 11/13 の 11:00〜12:00 に予定していますが、結果は未確定です。',
    originalPath: 'contests/odpt-2026/app-teiji/web/',
    sources: [
      { name: 'バスの位置（GTFS-RT）と時刻表（GTFS）', provider: '公共交通オープンデータセンター（各事業者）', license: 'CC BY 4.0', note: '位置から遅れを推定・集計した参考値です（実データでの推定精度は未検証）。事業者ごとの状態（蓄積前・サンプル不足）は画面内に表示します。' },
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
