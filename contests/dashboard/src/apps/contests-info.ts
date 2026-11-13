// ポータル用のコンペ情報。出典は reports/intel/<id>-20261109.md（取得日 2026-11-09）、contests/<id>/brief.md、
// contests/registry.json（締切の正）、reports/escalations/20261109-*.md。
// 要項で確認できていない事項は unconfirmed に分けて「未確認」と表示する。推測は書かない。
import type { ContestId } from './registry'

export interface DeadlineInfo {
  label: string
  /** registry.json の ISO 値 */
  at: string
  /** 表示用 */
  text: string
  /** 済んでいれば、済んだ日（ISO の日付）。締切の表示を「✓ 済」にする */
  doneAt?: string
  /** 済の言い方（例: 登録済）。省けば「済」 */
  doneLabel?: string
}

export interface CriterionInfo {
  name: string
  /** 公式表現の要約 */
  desc: string
  /** 補足タグ（例: 一次のみ・加点） */
  tag?: string
}

export interface ContestInfo {
  id: ContestId
  /** タブに出す短い名前 */
  tabName: string
  /** 何を募集しているか（1〜2行） */
  summary: string
  deadlines: DeadlineInfo[]
  /** 実装の要否 */
  implementation: string
  /** 提出物・提出方法 */
  submission: string[]
  /** 賞 */
  prize: string
  criteriaTitle: string
  criteria: CriterionInfo[]
  /** 審査基準についての但し書き（例示・版の違いなど） */
  criteriaNote: string
  /** 失格・無効・取消につながりうる条件／主な注意点 */
  cautions: string[]
  /** 未確認・要確認の事項 */
  unconfirmed: string[]
  /** 公式URL（出典） */
  sources: { label: string; url: string }[]
  /** 通過・受賞後に求められる条件（失格条件とは分けて見せる） */
  afterAward?: string[]
  /** アプリごとの、ポータルに添える現状の注記（誤解されやすい点） */
  appNotes?: Record<string, string>
  /** 他コンペのアプリだが、このコンペにも出すもの */
  alsoApps?: { id: string; note: string }[]
}

export const CONTEST_INFO: ContestInfo[] = [
  {
    id: 'udc-2026',
    tabName: 'UDC',
    summary:
      '都市・地域のオープンデータを使ったアプリ・データ・アイデア・アクティビティの4タイプを募集。一般部門とビジネス・プロフェッショナル部門がある。',
    deadlines: [
      { label: '概要登録', at: '2026-11-15T23:59:00+09:00', text: '11/15 23:59', doneAt: '2026-11-09', doneLabel: '登録済' },
      { label: '本応募', at: '2026-12-27T23:59:00+09:00', text: '12/27 23:59' },
    ],
    implementation: '実装は必須ではない（タイプにアイデアもある）。',
    submission: [
      '概要登録（Google フォーム）で、応募主体・作品タイプ1つ・テーマ1つ・特別賞の該当を入力。',
      '概要登録者に11月末までに事務局が本応募フォームを案内。本応募がなければ辞退扱い。',
      '最終審査は 2027/2/20（東京大学駒場）。オンライン登壇可・旅費は出ない。',
    ],
    prize: '賞金総額200万円。一般部門は金50万・銀20万・銅5万（表の読み取り）。特別賞あり。',
    criteriaTitle: '一次審査の3項目（公式）',
    criteria: [
      { name: '実用度', desc: '課題と、手法・価値が合っているか。' },
      { name: '完成度', desc: '手法の実装・実施がどこまで進んでいるか。' },
      { name: '挑戦度', desc: '新規性、成果の広がり、持続性、関係者の多様性。' },
      { name: '最終審査', desc: 'ファイナリストがシンポジウムで発表し、会場投票で決定。', tag: '一次とは別' },
    ],
    criteriaNote: '配点は要項に記載なし。重点分野の作品は審査で優遇される（どの分野かは未確認）。',
    cautions: [
      '1作品は1タイプ・1テーマのみ。',
      '同一主体の同一・類似作品、同一作品を別タイプ／テーマで出すと審査対象外になることがある。',
      '作品は原則公開できること。',
      '他コンテストで発表済み・公開済みの作品も応募可（UDC側の規定）。',
      '審査にIDやライセンスが要る場合は応募者が用意し、最低4本を最終審査まで確保する。',
    ],
    unconfirmed: [
      '概要登録フォームの入力項目・文字数（公式ページに記載なし）。',
      '2026年の重点分野、特別賞・ビジネス部門の賞金額。',
      '本応募フォームの項目・文字数（未公開）。',
    ],
    sources: [
      { label: 'UDC2026 募集要項', url: 'https://urbandata-challenge.jp/udc2026_entry' },
      { label: 'UDC 公式トップ', url: 'https://urbandata-challenge.jp/' },
    ],
    alsoApps: [{ id: 'odpt', note: '作品①としても提出するアプリ（公共交通オープンデータチャレンジにも出します）' }],
  },
  {
    id: 'satellite-2026',
    tabName: '衛星アワード',
    summary:
      '衛星データを使った、インフラのリスク可視化・防災・都市課題解決の「事業アイデア」を募集。協賛企業テーマ＋共通テーマ1・2から選ぶ。',
    deadlines: [{ label: '応募締切（必着）', at: '2026-11-30T12:00:00+09:00', text: '11/30 正午' }],
    implementation: '実装は不要。初期応募でプロトタイプは要らない（作れば最終のみ加点）。',
    submission: [
      '公式サイトから「様式1 提案書（.docx）」をダウンロードし、公式の応募フォームから提出。',
      '指定の様式・期間以外の応募は認められない。早期に出せば不備の指摘・再提出が可能。',
      '一次結果は12月上旬、最終選考は2027年5〜6月頃にオンラインでプレゼン。',
    ],
    prize: 'カナン・ジオリサーチ賞 300万円、審査委員特別賞 10万円。',
    criteriaTitle: '審査項目（要項p8）',
    criteria: [
      { name: '募集テーマ合致性', desc: 'テーマの趣旨を正しく読み、内容が合っているか。', tag: '一次のみ' },
      { name: '衛星データ活用の妥当性', desc: '衛星データが適切に使われ、解決策での重要性が高いか。' },
      { name: '事業の実現性・収益性', desc: '顧客・付加価値、市場規模、差別化、課題と対応方針。' },
      { name: '事業化による社会発展性', desc: '拡張性、事業化の工程、想定ユーザー、社会インパクト。' },
      { name: 'システム／アプリ開発', desc: '開発まで進んでいれば進捗に応じて加点。必須ではない。', tag: '加点・最終のみ' },
    ],
    criteriaNote: '配点・重み付けは要項に記載なし（未確認）。',
    cautions: [
      '明らかに事業化の意思がない案（学術・研究色が強い案）は選考対象外。',
      '各テーマへの応募は1提案まで。複数提案は可だが、代表者が重複すると重複応募扱いになるとのFAQがある。',
      '応募資格は、日本国に籍を有する個人・グループ、日本の法人格を持つ企業・大学・公的研究機関等（要項p3）。「代表者は日本国籍が必要」とのNEDO公式FAQの記載もあるが、本アワードに適用されるかは要確認（下の「未確認」参照）。',
      '実行委員会と同一の企業・団体（SSIL、カナン・ジオリサーチ）の所属者は代表者・メンバーになれない。',
    ],
    unconfirmed: [
      '様式1の項目・字数・ページ数（様式が読めていない）。',
      '重複応募FAQが本アワードにも適用されるか。2提案（A・B）を出す扱いは事務局への確認待ち。',
      '「代表者は日本国籍が必要」の記載はNEDO Challenge向けFAQの可能性があり、本アワードにも適用されるか（応募前に事務局へ確認）。',
    ],
    sources: [
      { label: '衛星データ活用アワード（公式）', url: 'https://canaan-geo.jp/satellite-data-award/' },
      { label: 'NEDO側の応募ページ', url: 'https://space-data-challenge.nedo.go.jp/infrastructure/' },
    ],
  },
  {
    id: 'ichibiz-2026',
    tabName: 'イチBiz',
    summary:
      '地理空間情報を活用した事業・サービスのアイデアを募集。ビジネス／アイデア／不動産情報活用の3部門。アイデア部門は実装不要。',
    deadlines: [
      { label: 'ビジネス部門', at: '2026-11-30T20:00:00+09:00', text: '11/30 20:00' },
      { label: 'アイデア・不動産部門', at: '2026-12-10T20:00:00+09:00', text: '12/10 20:00' },
    ],
    implementation: '実装は不要。補足資料（PDF/PPT 10ページ以内・任意）は付けられる。',
    submission: [
      '公式の応募フォームに入力。タイトル50字、課題400字、アイデア700字、背景300字。',
      'ビジネス部門だけ、市場・顧客ニーズ400字と事業化の課題400字が加わる。',
      '不動産情報活用部門だけ、活用する不動産情報ライブラリの情報を書く（字数は未確認）。',
      'デモアプリの現状: 不動産情報ライブラリの API から徳島市の取引価格（XIT001）・地価公示/地価調査（XPT002）・区域区分（XKT001）を事前に取得して同梱し、手順3と1枚シートに「ライブラリ由来」の印つきで出す（2026-11-12 取得）。',
    ],
    prize: '賞金総額200万円（予定）。受賞数・個別の額は未定。協賛企業の副賞が出ることもある。',
    criteriaTitle: '審査員が重視しうる点（例示）',
    criteria: [
      { name: '独創性', desc: '全部門共通の例示。語の定義は公式に記載なし。' },
      { name: '社会的インパクト', desc: '全部門共通の例示。語の定義は公式に記載なし。' },
      { name: '実現可能性', desc: '特にビジネス部門で重視されうる。' },
      { name: '持続性', desc: '継続できる仕組み・収益性。特にビジネス部門。' },
      { name: 'プレゼンテーション力', desc: '一次は書類、二次はビデオ選考、最終は有識者へのオンラインプレゼン。' },
    ],
    criteriaNote: 'これは要項の「例示」で、確定した評価項目や配点ではない。審査は提案内容のみが対象。',
    cautions: [
      '生成AIは補助利用なら可。出力をそのまま使ったもの、応募者の独自性が認められないものは応募を控える。',
      '第三者の知財の盗用・侵害は禁止。所属機関の知財に関わるなら事前承諾が必要。',
      '応募内容は協賛企業・外部審査員に提供される。完全に秘密にしたい案は応募しない。',
    ],
    afterAward: ['通過後は、プレゼン参加・表彰式（2027/3/19 東京ビッグサイト）への現地参加・現況調査への協力が条件。'],
    appNotes: {
      'biz-realestate':
        'デモの現状: 不動産情報ライブラリの API から徳島市の取引価格・地価公示/地価調査・区域区分を事前に取得して同梱し、手順3と1枚シートに「ライブラリ由来」の印つきで出しています（2026-11-12 取得）。',
    },
    unconfirmed: [
      '同一アイデアを複数部門に同時に出してよいか（公式に明記なし）。',
      'アイデア・不動産部門に二次・最終選考があるか。',
      '不動産部門の独自項目の字数。部門ごとの賞金配分。',
    ],
    sources: [
      { label: 'イチBizアワード2026 応募', url: 'https://g-idea.go.jp/2026/application/' },
      { label: 'よくある質問', url: 'https://g-idea.go.jp/2026/faq/' },
    ],
  },
  {
    id: 'odpt-2026',
    tabName: 'ODPT',
    summary:
      '公共交通オープンデータを使った、実際に動作するアプリ・サービスを募集。応募前に開発者登録とエントリーが必要。',
    deadlines: [{ label: '応募締切', at: '2027-01-11T23:59:00+09:00', text: '2027/1/11 23:59' }],
    implementation: '実装は必須。開催期間（〜2027/3/12）は誰でも無償で使える状態で公開する。',
    submission: [
      '開発者登録（確認に最大2営業日）→ チャレンジにエントリー → 開発 → 応募。',
      '専用サイトに開発者と作品の情報を登録し、ストアまたは任意のWebサイトで公開。',
      '一次審査のヒアリングは 2027/1/23〜24（オンライン）。選ばれた作品の応募者は出席必須。表彰式は 2/20。',
    ],
    prize: '賞金総額は最大300万円。賞ごとの金額・件数は未公表（審査会で決定）。',
    criteriaTitle: '審査基準（2025版の記載）',
    criteria: [
      { name: '社会課題解決への寄与', desc: '要項に説明の記載なし。' },
      { name: 'オープンデータ活用のインパクト', desc: '要項に説明の記載なし。' },
      { name: '技術的な完成度', desc: '要項に説明の記載なし。' },
      { name: 'UI/UXの完成度', desc: '要項に説明の記載なし。' },
    ],
    criteriaNote: '2025年のページの記載。2026版でも同じかは確認できていない（未確認）。',
    cautions: [
      '応募資格は、公共交通オープンデータセンターおよびGTFSデータリポジトリのデータの活用。',
      '提出後は説明文・紹介文を編集できない（直すなら別作品として再提出）。',
      'スマホアプリは運営会社への審査登録日が応募日。Webサービスで出すのが安全側。',
      '応募作品は開発者本人が考案・制作したものに限る。',
    ],
    unconfirmed: [
      '資格の「および」は両方必須か、どちらか一方でよいか（公式の記載から読み取れない）。',
      '応募フォームの項目・字数、動画やソース公開の要否。',
      '2026版の審査基準、賞ごとの賞金額、公開済み作品の応募可否。',
    ],
    sources: [
      { label: 'ODPTチャレンジ2026 概要', url: 'https://challenge2026.odpt.org/ja/outline.html' },
      { label: 'よくある質問', url: 'https://challenge2026.odpt.org/ja/faq.html' },
    ],
  },
]

/** 締切までの残りを日本語で返す。過ぎていれば「締切済み」。 */
export function remainingText(atIso: string, now: number = Date.now()): { text: string; past: boolean; urgent: boolean } {
  const ms = new Date(atIso).getTime() - now
  if (ms <= 0) return { text: '締切済み', past: true, urgent: false }
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 24) return { text: `あと${Math.max(hours, 1)}時間`, past: false, urgent: true }
  const days = Math.floor(ms / 86_400_000)
  return { text: `あと${days}日`, past: false, urgent: days <= 7 }
}

/** 次に来る、まだ済んでいない締切（済んだ締切は除く。全部過ぎていれば最後の締切） */
export function nextDeadline(info: ContestInfo) {
  const now = Date.now()
  const open = info.deadlines.filter((d) => !d.doneAt)
  return open.find((d) => new Date(d.at).getTime() > now) ?? open[open.length - 1] ?? info.deadlines[info.deadlines.length - 1]
}

/** 締切の近い順に並べたコンペ（一覧の本文とサイドバーで共通） */
export function contestsByDeadline(): ContestInfo[] {
  return [...CONTEST_INFO].sort((a, b) => Date.parse(nextDeadline(a).at) - Date.parse(nextDeadline(b).at))
}
