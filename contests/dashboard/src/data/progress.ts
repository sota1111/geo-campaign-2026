// 進捗データ（参謀長が更新する）。元データ: reports/ops/status-20261113.md（正本）。
// 更新するときは、まず正本の md を直し、この表を同じ文言に合わせる。構造は型で検査される（npm run typecheck）。
// 文言は正本に忠実に。足し引きしない。担当は「総司令官」「部隊」「待ち」。判断待ちは総司令官。担当が不明な項目は owner を省く（札を付けない）。
import type { ContestId } from '@/apps/registry'

export const PROGRESS_AS_OF = '2026-11-13'
export const PROGRESS_SOURCE = 'reports/ops/status-20261113.md'

/** 担当。待ち＝事務局など外部の返事待ち */
export type Owner = '総司令官' | '部隊' | '待ち'

export interface TodoItem {
  text: string
  /** 担当。判断待ちは総司令官。担当が本当に不明な項目は省く（画面では札を付けない） */
  owner?: Owner
  /** 正本が「要確認」「判断待ち」と付けた注記 */
  tag?: '要確認' | '判断待ち'
}

export interface PlanProgress {
  id: string
  contest: ContestId
  /** 一覧用の短い名前 */
  short: string
  /** 提出の見込み（今の案=提出予定、新しい案=比較中、UDC 作品③=出さない。部門ごとの最終決定は判断待ち） */
  intent: '提出予定' | '比較中' | '出さない'
  /** 札に添える注記（例: 「αと択一」）。未選定の案の作業は、判断の行の下に畳んで出す */
  intentNote?: string
  /** 案の名前（正本の見出し） */
  name: string
  /** 今の案／新しい案など（正本の見出しの括弧） */
  kind: string
  /** この案が属する締切（ISO）と表示。総司令官の作業を締切順に並べるために使う */
  deadlineAt: string
  deadlineLabel: string
  /** registry.ts の APPS の id（カードへのリンク用）。デモのない案は省く */
  appId?: string
  /** 正本の「決定」の行 */
  decided?: string
  done: string[]
  todo: TodoItem[]
  /** 正本の「改善の余地」 */
  improve?: string[]
  /** 案ごとの判断待ち（正本の「判断待ち」の行） */
  decisions?: string[]
}

export interface Decision {
  /** 正本の「判断待ちの一覧」の番号 */
  no: number
  contest: ContestId | 'registry'
  text: string
  /** 締切の ISO。正本に締切の記載がなければ省く */
  deadlineAt?: string
  deadlineLabel?: string
  /** この判断の結果しだいで要る作業を持つ案の id（比較中の案）。作業はこの判断の行の下に畳んで出す */
  plans?: string[]
}

/** 全体（正本の「全体」） */
export const OVERALL: string[] = [
  '提出に必要な本人欄（氏名・所属・体制・本人の経験など）は、どの応募もまだ空。総司令官が書くまで、どの案も「提出可能」ではない。',
  'マージ保留（総司令官補佐が SOP で止めた PR）: PR #18（太陽光発電所の盗難対策マップ。憲兵の失格級候補D1）、PR #19（子連れお出かけ診断。憲兵の監査なし・非商用条件が未解決）、PR #21（RN1 3地域版。本人欄が未記入）。reports/command/merge-20261114.md',
]

const UDC = { deadlineAt: '2026-12-27T23:59:00+09:00', deadlineLabel: '本応募 12/27 23:59' }
const SAT = { deadlineAt: '2026-11-30T12:00:00+09:00', deadlineLabel: '11/30 12:00（正午）' }
const BIZ_BUSINESS = { deadlineAt: '2026-11-30T20:00:00+09:00', deadlineLabel: '11/30 20:00' }
const BIZ_OTHER = { deadlineAt: '2026-12-10T20:00:00+09:00', deadlineLabel: '12/10 20:00' }
const ODPT = { deadlineAt: '2027-01-11T23:59:00+09:00', deadlineLabel: '2027/1/11 23:59' }

export const PLANS: PlanProgress[] = [
  {
    id: 'udc-1', short: '作品①', intent: '提出予定', contest: 'udc-2026', name: '作品① 生活アクセス診断マップ', kind: '今の案', ...UDC, appId: 'odpt',
    done: ['概要登録（11/9、総司令官。reports/ops/udc-2026-registration-20261109.md）', 'アプリ実装（ODPT と共通）', '作品説明の下書き'],
    todo: [
      { text: 'アプリの公開URL（本応募に必要）', owner: '総司令官' },
      { text: '本応募フォームの案内を待つ（11月末、事務局から）', owner: '待ち' },
      { text: '本応募の記入', owner: '総司令官' },
    ],
    improve: ['差別化の節に「既存手段との違い・持続性・関係者」を足すと点が上がる見込み（独立採点 9/15。reports/ops/udc-2026-entry1-vs-aed-independent-20261113.md）'],
  },
  {
    id: 'udc-2', short: '作品②', intent: '提出予定', contest: 'udc-2026', name: '作品② みんなの盛土ウォッチ', kind: '今の案', ...UDC, appId: 'udc-moritsuchi',
    done: ['概要登録（11/9）', 'アイデアとしての作品説明', 'ダッシュボードのデモ'],
    todo: [
      { text: '本応募でアプリケーションに変えるか（対象自治体の選定が前提。11/30 以降に工兵が試作する予定）', tag: '判断待ち', owner: '総司令官' },
      { text: '本応募の記入', owner: '総司令官' },
    ],
  },
  {
    id: 'udc-3', short: '作品③', intent: '出さない', contest: 'udc-2026', name: '作品③ 夜も使えるAED診断マップ', kind: '新しい案', ...BIZ_OTHER, appId: 'udc-aed',
    decided: 'UDC には登録しない（11/13 総司令官）。アプリはイチBiz IN1 のデモとして使う。',
    done: ['アプリ実装（町田・福岡・井原・倉敷）', 'アグレッサー・作戦研究班・憲兵・デザイン審査（重大なし）'],
    // 残作業は IN1（biz-idea-in1）の側に置く。UDC には残らない
    todo: [],
  },
  {
    id: 'sat-a', short: '提案A', intent: '提出予定', contest: 'satellite-2026', name: '提案A 路面下リスクの二段階調査', kind: '今の案・協賛企業テーマ＋共通テーマ1', ...SAT, appId: 'sat-a',
    done: ['提案書（docx 様式検査OK）', 'デモ'],
    todo: [
      { text: '申請者欄・体制欄の記入', owner: '総司令官' },
      { text: 'Word での体裁確認', owner: '総司令官' },
      { text: 'フォームから提出', owner: '総司令官' },
    ],
  },
  {
    id: 'sat-b', short: '提案B', intent: '比較中', intentNote: 'αと択一', contest: 'satellite-2026', name: '提案B 盛土巡視台帳', kind: '今の案・共通テーマ2', ...SAT, appId: 'sat-b',
    done: ['提案書（docx 様式検査OK）', 'デモ', '独立採点 16（αより上）'],
    todo: [
      { text: '申請者欄・体制欄', owner: '総司令官' },
      { text: 'SAR の変位と後方散乱の書き方を揃える小修正（B を選んだ場合）', owner: '部隊' },
      { text: '提出', owner: '総司令官' },
    ],
  },
  {
    id: 'sat-alpha', short: '新案α', intent: '比較中', contest: 'satellite-2026', name: '新案α 配電線沿いの優先伐採地図', kind: '新しい案・共通テーマ2', ...SAT, appId: 'sat-alpha',
    done: ['提案書（check_docx OK）', 'デモ（テスト18件）', 'アグレッサー・作戦研究班（12→15）・憲兵'],
    todo: [
      { text: '本人欄（憲兵の失格級＝未記入）', owner: '総司令官' },
      { text: '市場規模の金額がない' },
      { text: 'アグレッサーの失敗テスト2件（データの取り直しが必要）' },
    ],
    decisions: ['B とαのどちらを共通テーマ2に出すか（同時提出は不可）。FAQ7（同じ代表者の2提案）を事務局に確認するか'],
  },
  {
    id: 'biz-business', short: 'ビジネス 今の案', intent: '提出予定', contest: 'ichibiz-2026', name: 'ビジネス部門: バス路線見直し案の比較', kind: '今の案', ...BIZ_BUSINESS, appId: 'biz-business',
    done: ['提出文（字数OK）', '補足資料 PPT（7枚）', 'デモ', '独立採点 17'],
    todo: [
      { text: '本人欄・背景欄（生成AI条項のため本人の書き換えが必須）', owner: '総司令官' },
      { text: 'PPT の記入7か所', owner: '総司令官' },
      { text: '登録', owner: '総司令官' },
    ],
  },
  {
    id: 'biz-business-nb', short: 'ビジネス NB', intent: '比較中', contest: 'ichibiz-2026', name: 'ビジネス部門: NB 使用済み太陽光パネルの回収圏計画', kind: '新しい案', ...BIZ_BUSINESS, appId: 'biz-business-nb',
    done: ['提出文（字数OK）', 'デモ（京都府の実データ）', 'アグレッサー・作戦研究班（16→19）・憲兵', '独立採点 18'],
    todo: [
      { text: '本人欄（失格級＝未記入）', owner: '総司令官' },
      { text: '北部拠点の受け入れ確認' },
      { text: '地理院の住所検索 API の利用条件' },
    ],
  },
  {
    id: 'biz-idea', short: 'アイデア 今の案', intent: '提出予定', contest: 'ichibiz-2026', name: 'アイデア部門: 地名の記憶マップ', kind: '今の案', ...BIZ_OTHER, appId: 'biz-idea',
    done: ['提出文（字数OK）', 'デモ'],
    todo: [
      { text: '本人欄・背景欄', owner: '総司令官' },
      { text: '登録', owner: '総司令官' },
    ],
  },
  {
    id: 'biz-idea-in1', short: 'アイデア IN1', intent: '比較中', contest: 'ichibiz-2026', name: 'アイデア部門: IN1 いま使えるAED地図', kind: '新しい案', ...BIZ_OTHER, appId: 'udc-aed',
    done: ['提出文（自己採点 17）', 'デモ＝AED マップ（数字を11台・2か所にそろえた）'],
    todo: [
      { text: '本人欄', owner: '総司令官' },
      { text: 'アプリの公開（デモ＝AED マップ）', owner: '総司令官' },
      { text: '国土数値情報の承認表示の要否', tag: '要確認' },
      { text: '町田市の24時間AED協定の確認', tag: '要確認' },
      { text: '本文の「現在地の案内」「住民の投稿」はアプリにない（本文を直すかアプリに足すか）' },
    ],
  },
  {
    id: 'biz-realestate', short: '不動産 今の案', intent: '提出予定', contest: 'ichibiz-2026', name: '不動産部門: 相談前の1枚シート', kind: '今の案', ...BIZ_OTHER, appId: 'biz-realestate',
    done: ['提出文（字数OK）', 'デモ（不動産情報ライブラリの実データ）'],
    todo: [
      { text: '本人欄・背景欄', owner: '総司令官' },
      { text: '登録', owner: '総司令官' },
    ],
  },
  {
    id: 'biz-realestate-rn1', short: '不動産 RN1', intent: '比較中', contest: 'ichibiz-2026', name: '不動産部門: RN1 住む場所の先行き', kind: '新しい案', ...BIZ_OTHER, appId: 'biz-realestate-rn1',
    done: ['提出文（作戦研究班 14→20）', 'デモ（徳島市の実データ12項目、テスト31＋14件）', '憲兵（指摘対応済み）'],
    todo: [
      { text: '本人欄3か所（失格級＝未記入。PR #21 は記入と憲兵の再監査までマージ保留）', owner: '総司令官' },
      { text: 'XKT003・XKT025 の利用条件の問い合わせ', tag: '判断待ち', owner: '総司令官' },
      { text: '同梱データ約4.5MBの承認', tag: '判断待ち', owner: '総司令官' },
      { text: 'ライブラリ欄の字数上限（395/400、フォームで確認）' },
    ],
  },
  {
    id: 'biz-solar-guard', short: '太陽光 盗難対策', intent: '比較中', intentNote: '部門未定', contest: 'ichibiz-2026', name: '太陽光発電所の盗難対策マップ', kind: '新しい案・部門未定、PR #18', ...BIZ_BUSINESS,
    done: ['デモ（茨城県、個別設備を出さない集計地図＋自己診断）', '憲兵の監査'],
    todo: [
      { text: '認定情報の利用ルールの確認先と、確認できない場合の扱い（憲兵の失格級候補D1。PR #18 は解消まで保留。reports/escalations/20261114-solar-guard-data-terms.md）', tag: '判断待ち', owner: '総司令官' },
    ],
  },
  {
    id: 'odpt', short: '診断マップ', intent: '提出予定', contest: 'odpt-2026', name: '生活アクセス診断マップ', kind: '今の案', ...ODPT, appId: 'odpt',
    done: ['アプリ実装（テスト緑）', '初見ユーザー試験の改善', '開発者の連絡先（PR #11）'],
    todo: [
      { text: '応募フォーム各項目の下書き（PR #12 で作業中）', owner: '部隊' },
      { text: 'アプリの公開', owner: '総司令官' },
      { text: '憲兵の監査（未実施）' },
    ],
  },
  {
    id: 'odpt-teiji', short: 'N2 定時性', intent: '比較中', contest: 'odpt-2026', name: 'N2 バス定時性カルテ', kind: '新しい案', ...ODPT, appId: 'odpt-teiji',
    done: ['アプリ第1版（テスト84件）', '昼間1時間の品質測定（24事業者中14通過。reports/ops/odpt-2026-teiji-daytime-quality-20261113.md）'],
    todo: [
      { text: '数週間の連続収集（場所と担当）', tag: '判断待ち', owner: '総司令官' },
      { text: '実データでの精度確認' },
      { text: '提出文の磨き込み・監査' },
    ],
    decisions: ['区間ごとの遅れを公開するか'],
  },
]

/** 判断待ちの一覧（正本の「判断待ちの一覧（締切順）」） */
export const DECISIONS: Decision[] = [
  { no: 1, contest: 'satellite-2026', text: '衛星: B とαのどちらを出すか、FAQ7 の確認', deadlineAt: '2026-11-30T12:00:00+09:00', deadlineLabel: '11/30 12:00', plans: ['sat-b', 'sat-alpha'] },
  { no: 2, contest: 'ichibiz-2026', text: 'イチBiz ビジネス部門: 今の案・NB・両方', deadlineAt: '2026-11-30T20:00:00+09:00', deadlineLabel: '11/30 20:00', plans: ['biz-business-nb'] },
  { no: 3, contest: 'ichibiz-2026', text: 'イチBiz アイデア・不動産部門: 今の案・新しい案・両方、RN1 の利用条件の問い合わせと同梱データ', deadlineAt: '2026-12-10T20:00:00+09:00', deadlineLabel: '12/10', plans: ['biz-idea-in1', 'biz-realestate-rn1'] },
  { no: 4, contest: 'udc-2026', text: 'UDC 作品②: 本応募でアプリケーションに変えるか', deadlineAt: '2026-12-27T23:59:00+09:00', deadlineLabel: '12/27' },
  { no: 5, contest: 'odpt-2026', text: 'ODPT N2: 連続収集の場所と担当、区間ごとの遅れの公開', deadlineAt: '2027-01-11T23:59:00+09:00', deadlineLabel: '2027/1/11' },
  { no: 6, contest: 'registry', text: 'registry.json: UDC の作品概要の上限 100字を登録するか' },
]

export interface CommanderTask {
  plan: PlanProgress
  task: TodoItem
}

/** まだ選ばれていない案（比較中で、判断の行に紐づく案）。その作業は判断の下に畳む */
export function isConditionalPlan(p: PlanProgress, decisions: Decision[] = DECISIONS): boolean {
  return p.intent === '比較中' && decisions.some((d) => d.plans?.includes(p.id))
}

/** 総司令官の作業を、案の締切順に並べて返す（同じ締切の中は正本の並び）。conditional=false なら、未選定の案の作業を除く */
export function commanderTasks(plans: PlanProgress[] = PLANS, conditional = true): CommanderTask[] {
  return plans
    .filter((p) => conditional || !isConditionalPlan(p))
    .flatMap((plan) => plan.todo.filter((task) => task.owner === '総司令官').map((task) => ({ plan, task })))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Date.parse(a.r.plan.deadlineAt) - Date.parse(b.r.plan.deadlineAt) || a.i - b.i)
    .map((x) => x.r)
}

/** 締切ごとにまとめる（締切順に並んだ行を渡す） */
export function groupByDeadline(rows: CommanderTask[]) {
  const out: { at: string; label: string; rows: CommanderTask[] }[] = []
  for (const r of rows) {
    const g = out.find((x) => x.at === r.plan.deadlineAt)
    if (g) g.rows.push(r)
    else out.push({ at: r.plan.deadlineAt, label: r.plan.deadlineLabel, rows: [r] })
  }
  return out
}

export function plansByContest(contest: ContestId): PlanProgress[] {
  return PLANS.filter((p) => p.contest === contest)
}
