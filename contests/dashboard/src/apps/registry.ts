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
  /** 'new' = 新しい案（比較用・未選定）。省略時は今の案 */
  plan?: 'current' | 'new'
  /** 新しい案が隣に並ぶ、今の案の id（ポータルで同じ部門の中に並べる） */
  pairWith?: string
  /** 新しい案のカードに添える注記（同時提出不可など） */
  pairNote?: string
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
  /** カードの本文（何の案か・何がまだ無いか） */
  note: string
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
  },
]

export const CARDS_ONLY: CardOnly[] = [
  {
    id: 'biz-idea-in1',
    name: '「いま使えるAED」地図　夜間・施錠で使えない場所を、時間帯別のカバー率にする',
    contest: 'ichibiz-2026',
    division: 'アイデア部門（新案IN1）',
    pairWith: 'biz-idea',
    note: 'AEDの地図は公開されていても、点は「いつ使えるか」を示さない。町田市の公開データでは、位置と利用時間が記入された288台のうち、平日午前3時に使えるのは14台（本案の簡易判定）。提出文のみで、デモは UDC の「夜間・休日に使えるAED地図」を使う予定（準備中）。',
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

/** 今の案 id から、その隣に並ぶ新しい案を引く（今の案のヘッダーに「見比べる」リンクを出すため） */
export function newPlansOf(currentId: string): AppMeta[] {
  return APPS.filter((a) => isNewPlan(a) && a.pairWith === currentId)
}
